import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { Chunk, Edge, SourceAdapter } from "@wtfoc/common";
import {
	GitHubApiError,
	GitHubCliMissingError,
	GitHubNotFoundError,
	GitHubRateLimitError,
	WtfocError,
} from "@wtfoc/common";
import { RegexEdgeExtractor } from "../edges/extractor.js";

const execFileAsync = promisify(execFile);

export interface GitHubAdapterConfig {
	owner: string;
	repo: string;
	since?: string;
	types?: Array<"issues" | "pulls" | "comments" | "discussions">;
}

export type ExecFn = (
	cmd: string,
	args: string[],
	signal?: AbortSignal,
) => Promise<{ stdout: string; stderr: string }>;

const DEFAULT_TYPES: Array<"issues" | "pulls" | "comments" | "discussions"> = [
	"issues",
	"pulls",
	"comments",
];
const MAX_RATE_LIMIT_WAIT_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 5000;

async function defaultExecFn(
	cmd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
	return execFileAsync(cmd, args, { signal, maxBuffer: 50 * 1024 * 1024 });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

/**
 * Parse paginated gh api output. With --paginate, gh api emits
 * one JSON array per page concatenated in stdout. We need to handle
 * both single-array and multi-array (JSONL-like) output.
 */
function parsePaginatedJson(stdout: string): unknown[] {
	const trimmed = stdout.trim();
	if (!trimmed) return [];

	// Try single JSON parse first (single page or --slurp)
	try {
		const parsed = JSON.parse(trimmed);
		return Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		// Multi-page: gh api --paginate emits multiple JSON arrays
		// Try splitting on ][ boundary (array concatenation)
		const results: unknown[] = [];
		// gh api --paginate concatenates arrays: [page1][page2]
		// Split by finding ][, parse each chunk
		const chunks = trimmed.split(/\]\s*\[/);
		for (let i = 0; i < chunks.length; i++) {
			let chunk = chunks[i] ?? "";
			if (i === 0 && !chunk.startsWith("[")) chunk = `[${chunk}`;
			else if (i > 0) chunk = `[${chunk}`;
			if (i === chunks.length - 1 && !chunk.endsWith("]")) chunk = `${chunk}]`;
			else if (i < chunks.length - 1) chunk = `${chunk}]`;
			try {
				const parsed = JSON.parse(chunk);
				if (Array.isArray(parsed)) results.push(...parsed);
				else results.push(parsed);
			} catch {
				// Skip unparseable page chunks in multi-page output
			}
		}
		if (results.length === 0 && trimmed.length > 0) {
			throw new SyntaxError(`Failed to parse GitHub API response: ${trimmed.slice(0, 100)}`);
		}
		return results;
	}
}

export class GitHubAdapter implements SourceAdapter<GitHubAdapterConfig> {
	readonly sourceType = "github";
	readonly #execFn: ExecFn;

	constructor(execFn?: ExecFn) {
		this.#execFn = execFn ?? defaultExecFn;
	}

	parseConfig(raw: Record<string, unknown>): GitHubAdapterConfig {
		const source = raw.source;
		if (typeof source !== "string" || !source.includes("/")) {
			throw new WtfocError(
				'GitHub adapter requires source in "owner/repo" format',
				"INVALID_CONFIG",
				{ source },
			);
		}
		const [owner, repo] = source.split("/");
		if (!owner || !repo) {
			throw new WtfocError(
				'GitHub adapter requires source in "owner/repo" format',
				"INVALID_CONFIG",
				{ source },
			);
		}

		const since = typeof raw.since === "string" ? raw.since : undefined;
		const types = Array.isArray(raw.types)
			? (raw.types as GitHubAdapterConfig["types"])
			: undefined;

		return { owner, repo, since, types };
	}

	async *ingest(config: GitHubAdapterConfig, signal?: AbortSignal): AsyncIterable<Chunk> {
		const types: Array<"issues" | "pulls" | "comments" | "discussions"> = config.types
			? [...config.types]
			: [...DEFAULT_TYPES];

		if (types.includes("issues")) {
			yield* this.#ingestIssues(config, signal);
		}
		if (types.includes("pulls")) {
			yield* this.#ingestPulls(config, signal);
		}
		if (types.includes("comments")) {
			const prs = await this.#fetchPullNumbers(config, signal);
			for (const prNumber of prs) {
				yield* this.#ingestPrComments(config, prNumber, signal);
			}
		}
		if (types.includes("discussions")) {
			try {
				yield* this.#ingestDiscussions(config, signal);
			} catch (err) {
				// Only skip if discussions are genuinely not available
				if (err instanceof GitHubNotFoundError) {
					// Discussions not enabled — skip gracefully
				} else if (
					err instanceof GitHubApiError &&
					(String(err.context?.cause).includes("DISCUSSION") ||
						String(err.message).includes("discussions"))
				) {
					// GraphQL discussions query not supported — skip
				} else {
					throw err;
				}
			}
		}
	}

	extractEdges(chunks: Chunk[]): Edge[] {
		const extractor = new RegexEdgeExtractor();
		return extractor.extract(chunks);
	}

	async #ghApi(path: string, signal?: AbortSignal, extraArgs?: string[]): Promise<unknown[]> {
		// No --include: rate limit info comes via stderr, not headers.
		// --paginate handles Link-header pagination automatically.
		const args = ["api", path, "--paginate", "--method", "GET"];
		if (extraArgs) args.push(...extraArgs);

		let totalWaitMs = 0;
		let attempt = 0;

		while (true) {
			signal?.throwIfAborted();
			try {
				const { stdout } = await this.#execFn("gh", args, signal);
				return parsePaginatedJson(stdout);
			} catch (err: unknown) {
				const errMsg = err instanceof Error ? err.message : String(err);
				const stderr = (err as { stderr?: string }).stderr ?? errMsg;

				if (stderr.includes("ENOENT") || errMsg.includes("ENOENT")) {
					throw new GitHubCliMissingError();
				}
				if (stderr.includes("Not Found") || stderr.includes("404")) {
					throw new GitHubNotFoundError(path);
				}
				// Only retry on explicit rate limit messages, not generic 403
				if (stderr.includes("rate limit") || stderr.includes("API rate limit exceeded")) {
					const waitMs = this.#parseRetryWait(stderr) ?? BASE_BACKOFF_MS * 2 ** attempt;
					if (totalWaitMs + waitMs > MAX_RATE_LIMIT_WAIT_MS) {
						throw new GitHubRateLimitError(path);
					}
					await sleep(waitMs, signal);
					totalWaitMs += waitMs;
					attempt++;
					continue;
				}
				throw new GitHubApiError(errMsg, path, err);
			}
		}
	}

	#parseRetryWait(stderr: string): number | undefined {
		const retryAfterMatch = stderr.match(/retry.after[:\s]+(\d+)/i);
		if (retryAfterMatch?.[1]) {
			return Number.parseInt(retryAfterMatch[1], 10) * 1000;
		}
		const resetMatch = stderr.match(/x-ratelimit-reset[:\s]+(\d+)/i);
		if (resetMatch?.[1]) {
			const resetTime = Number.parseInt(resetMatch[1], 10) * 1000;
			const waitMs = resetTime - Date.now();
			return waitMs > 0 ? waitMs : BASE_BACKOFF_MS;
		}
		return undefined;
	}

	async *#ingestIssues(config: GitHubAdapterConfig, signal?: AbortSignal): AsyncIterable<Chunk> {
		const sinceArgs = config.since ? ["-f", `since=${config.since}`] : [];
		const items = await this.#ghApi(
			`repos/${config.owner}/${config.repo}/issues?state=all`,
			signal,
			sinceArgs,
		);
		const repo = `${config.owner}/${config.repo}`;

		for (const item of items) {
			const rec = item as Record<string, unknown>;
			if (rec.pull_request) continue;
			if (!rec.title && !rec.body) continue;

			const number = String(rec.number ?? "");
			const body = String(rec.body ?? "");
			const title = String(rec.title ?? "");
			const content = `# ${title}\n\n${body}`;

			yield {
				id: createHash("sha256").update(content).digest("hex"),
				content,
				sourceType: "github-issue",
				source: `${repo}#${number}`,
				sourceUrl: String(rec.html_url ?? ""),
				timestamp: String(rec.updated_at ?? rec.created_at ?? ""),
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {
					number,
					state: String(rec.state ?? ""),
					labels: Array.isArray(rec.labels)
						? rec.labels
								.map((l: unknown) =>
									typeof l === "object" && l !== null
										? String((l as Record<string, unknown>).name ?? "")
										: String(l),
								)
								.join(",")
						: "",
					author: String((rec.user as Record<string, unknown>)?.login ?? ""),
					createdAt: String(rec.created_at ?? ""),
					updatedAt: String(rec.updated_at ?? ""),
				},
			};
		}
	}

	async *#ingestPulls(config: GitHubAdapterConfig, signal?: AbortSignal): AsyncIterable<Chunk> {
		// /pulls does NOT support `since` param — no since args here
		const items = await this.#ghApi(`repos/${config.owner}/${config.repo}/pulls?state=all`, signal);
		const repo = `${config.owner}/${config.repo}`;

		for (const item of items) {
			const rec = item as Record<string, unknown>;
			if (!rec.title && !rec.body) continue;

			const number = String(rec.number ?? "");
			const body = String(rec.body ?? "");
			const title = String(rec.title ?? "");
			const content = `# ${title}\n\n${body}`;

			yield {
				id: createHash("sha256").update(content).digest("hex"),
				content,
				sourceType: "github-pr",
				source: `${repo}#${number}`,
				sourceUrl: String(rec.html_url ?? ""),
				timestamp: String(rec.updated_at ?? rec.created_at ?? ""),
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {
					number,
					state: String(rec.state ?? ""),
					merged: String(rec.merged ?? "false"),
					author: String((rec.user as Record<string, unknown>)?.login ?? ""),
					createdAt: String(rec.created_at ?? ""),
					updatedAt: String(rec.updated_at ?? ""),
				},
			};
		}
	}

	async #fetchPullNumbers(config: GitHubAdapterConfig, signal?: AbortSignal): Promise<number[]> {
		const items = await this.#ghApi(`repos/${config.owner}/${config.repo}/pulls?state=all`, signal);
		return items
			.map((item) => (item as Record<string, unknown>).number)
			.filter((n): n is number => typeof n === "number");
	}

	async *#ingestPrComments(
		config: GitHubAdapterConfig,
		prNumber: number,
		signal?: AbortSignal,
	): AsyncIterable<Chunk> {
		const items = await this.#ghApi(
			`repos/${config.owner}/${config.repo}/pulls/${prNumber}/comments`,
			signal,
		);
		const repo = `${config.owner}/${config.repo}`;

		for (const item of items) {
			const rec = item as Record<string, unknown>;
			const body = String(rec.body ?? "");
			if (!body) continue;

			if (config.since) {
				const commentDate = new Date(String(rec.updated_at ?? rec.created_at ?? ""));
				const sinceDate = new Date(config.since);
				if (commentDate < sinceDate) continue;
			}

			const commentId = String(rec.id ?? "");

			yield {
				id: createHash("sha256").update(body).digest("hex"),
				content: body,
				sourceType: "github-pr-comment",
				source: `${repo}#${prNumber}`,
				sourceUrl: String(rec.html_url ?? ""),
				timestamp: String(rec.updated_at ?? rec.created_at ?? ""),
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {
					commentId,
					parentPr: String(prNumber),
					author: String((rec.user as Record<string, unknown>)?.login ?? ""),
					createdAt: String(rec.created_at ?? ""),
				},
			};
		}
	}

	async *#ingestDiscussions(
		config: GitHubAdapterConfig,
		signal?: AbortSignal,
	): AsyncIterable<Chunk> {
		const repo = `${config.owner}/${config.repo}`;
		let hasNextPage = true;
		let cursor: string | null = null;

		while (hasNextPage) {
			signal?.throwIfAborted();
			const afterClause = cursor ? `, after: "${cursor}"` : "";
			const query = `query { repository(owner: "${config.owner}", name: "${config.repo}") { discussions(first: 100${afterClause}) { pageInfo { hasNextPage endCursor } nodes { number title body url createdAt author { login } category { name } } } } }`;
			const args = ["api", "graphql", "-f", `query=${query}`];

			let result: { stdout: string };
			try {
				result = await this.#execFn("gh", args, signal);
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				if (errMsg.includes("ENOENT")) throw new GitHubCliMissingError();
				if (errMsg.includes("Not Found") || errMsg.includes("404")) {
					throw new GitHubNotFoundError(repo);
				}
				throw new GitHubApiError("Failed to fetch discussions", repo, err);
			}

			const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
			if (parsed.errors) {
				throw new GitHubApiError(
					`GraphQL errors: ${JSON.stringify(parsed.errors)}`,
					repo,
					parsed.errors,
				);
			}

			const data = parsed.data as Record<string, unknown> | undefined;
			const repository = data?.repository as Record<string, unknown> | undefined;
			const discussions = repository?.discussions as Record<string, unknown> | undefined;
			const pageInfo = discussions?.pageInfo as
				| { hasNextPage?: boolean; endCursor?: string }
				| undefined;
			const nodes = (discussions?.nodes ?? []) as Array<Record<string, unknown>>;

			for (const node of nodes) {
				const body = String(node.body ?? "");
				const title = String(node.title ?? "");
				if (!title && !body) continue;

				const number = String(node.number ?? "");
				const content = `# ${title}\n\n${body}`;

				yield {
					id: createHash("sha256").update(content).digest("hex"),
					content,
					sourceType: "github-discussion",
					source: `${repo}/discussions/${number}`,
					sourceUrl: String(node.url ?? ""),
					timestamp: String(node.createdAt ?? ""),
					chunkIndex: 0,
					totalChunks: 1,
					metadata: {
						number,
						author: String((node.author as Record<string, unknown>)?.login ?? ""),
						category: String((node.category as Record<string, unknown>)?.name ?? ""),
						createdAt: String(node.createdAt ?? ""),
					},
				};
			}

			hasNextPage = pageInfo?.hasNextPage ?? false;
			cursor = pageInfo?.endCursor ?? null;
		}
	}
}

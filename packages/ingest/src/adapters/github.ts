import { execFile } from "node:child_process";
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
				if (err instanceof GitHubNotFoundError || err instanceof GitHubApiError) {
					// Discussions not enabled — skip gracefully
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

	async #ghApi(
		path: string,
		config: GitHubAdapterConfig,
		signal?: AbortSignal,
		paginate = true,
	): Promise<unknown[]> {
		const args = ["api", path, "--paginate"];
		if (config.since) {
			args.push("-f", `since=${config.since}`);
		}

		let totalWaitMs = 0;
		let attempt = 0;

		while (true) {
			signal?.throwIfAborted();
			try {
				const { stdout } = await this.#execFn("gh", args, signal);
				const parsed = JSON.parse(stdout);
				return Array.isArray(parsed) ? parsed : [parsed];
			} catch (err: unknown) {
				const errMsg = err instanceof Error ? err.message : String(err);
				const stderr = (err as { stderr?: string }).stderr ?? errMsg;

				if (stderr.includes("ENOENT") || errMsg.includes("ENOENT")) {
					throw new GitHubCliMissingError();
				}
				if (stderr.includes("Not Found") || stderr.includes("404")) {
					throw new GitHubNotFoundError(`${config.owner}/${config.repo}`);
				}
				if (stderr.includes("rate limit") || stderr.includes("403")) {
					const waitMs = this.#parseRetryWait(stderr) ?? BASE_BACKOFF_MS * 2 ** attempt;
					if (totalWaitMs + waitMs > MAX_RATE_LIMIT_WAIT_MS) {
						throw new GitHubRateLimitError(`${config.owner}/${config.repo}`);
					}
					await sleep(waitMs, signal);
					totalWaitMs += waitMs;
					attempt++;
					continue;
				}
				throw new GitHubApiError(errMsg, `${config.owner}/${config.repo}`, err);
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
		const items = await this.#ghApi(`repos/${config.owner}/${config.repo}/issues`, config, signal);
		const repo = `${config.owner}/${config.repo}`;

		for (const item of items) {
			const rec = item as Record<string, unknown>;
			// Filter out PRs (issues endpoint includes them)
			if (rec.pull_request) continue;
			if (!rec.title && !rec.body) continue;

			const number = String(rec.number ?? "");
			const body = String(rec.body ?? "");
			const title = String(rec.title ?? "");
			const content = `# ${title}\n\n${body}`;

			yield {
				id: this.#chunkId(content),
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
		const items = await this.#ghApi(
			`repos/${config.owner}/${config.repo}/pulls?state=all`,
			config,
			signal,
		);
		const repo = `${config.owner}/${config.repo}`;

		for (const item of items) {
			const rec = item as Record<string, unknown>;
			if (!rec.title && !rec.body) continue;

			const number = String(rec.number ?? "");
			const body = String(rec.body ?? "");
			const title = String(rec.title ?? "");
			const content = `# ${title}\n\n${body}`;

			yield {
				id: this.#chunkId(content),
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
		const items = await this.#ghApi(
			`repos/${config.owner}/${config.repo}/pulls?state=all`,
			config,
			signal,
		);
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
			config,
			signal,
		);
		const repo = `${config.owner}/${config.repo}`;

		for (const item of items) {
			const rec = item as Record<string, unknown>;
			const body = String(rec.body ?? "");
			if (!body) continue;

			// Client-side since filtering for comments
			if (config.since) {
				const commentDate = new Date(String(rec.updated_at ?? rec.created_at ?? ""));
				const sinceDate = new Date(config.since);
				if (commentDate < sinceDate) continue;
			}

			const commentId = String(rec.id ?? "");

			yield {
				id: this.#chunkId(body),
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
		const query = `query { repository(owner: "${config.owner}", name: "${config.repo}") { discussions(first: 100) { nodes { number title body url createdAt author { login } category { name } } } } }`;
		const args = ["api", "graphql", "-f", `query=${query}`];

		signal?.throwIfAborted();
		let result: { stdout: string };
		try {
			result = await this.#execFn("gh", args, signal);
		} catch (err) {
			throw new GitHubApiError(
				"Failed to fetch discussions",
				`${config.owner}/${config.repo}`,
				err,
			);
		}

		const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
		const data = parsed.data as Record<string, unknown> | undefined;
		const repository = data?.repository as Record<string, unknown> | undefined;
		const discussions = repository?.discussions as Record<string, unknown> | undefined;
		const nodes = (discussions?.nodes ?? []) as Array<Record<string, unknown>>;
		const repo = `${config.owner}/${config.repo}`;

		for (const node of nodes) {
			const body = String(node.body ?? "");
			const title = String(node.title ?? "");
			if (!title && !body) continue;

			const number = String(node.number ?? "");
			const content = `# ${title}\n\n${body}`;

			yield {
				id: this.#chunkId(content),
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
	}

	#chunkId(content: string): string {
		const { createHash } = require("node:crypto") as typeof import("node:crypto");
		return createHash("sha256").update(content).digest("hex");
	}
}

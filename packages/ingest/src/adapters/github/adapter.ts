import type { Chunk, Edge, SourceAdapter } from "@wtfoc/common";
import {
	GitHubApiError,
	GitHubCliMissingError,
	GitHubNotFoundError,
	WtfocError,
} from "@wtfoc/common";
import { chunkMarkdown } from "../../chunker.js";
import { RegexEdgeExtractor } from "../../edges/extractor.js";
import { defaultExecFn, type ExecFn, ghApi } from "./transport.js";

export interface GitHubAdapterConfig {
	owner: string;
	repo: string;
	since?: string;
	types?: Array<"issues" | "pulls" | "comments" | "discussions">;
}

const DEFAULT_TYPES: Array<"issues" | "pulls" | "comments" | "discussions"> = [
	"issues",
	"pulls",
	"comments",
];

/** Max chars per chunk for GitHub content. Uses the shared default from chunker. */
const GITHUB_CHUNK_SIZE = 4000;

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

	async extractEdges(chunks: Chunk[]): Promise<Edge[]> {
		const extractor = new RegexEdgeExtractor();
		return extractor.extract(chunks);
	}

	async *#ingestIssues(config: GitHubAdapterConfig, signal?: AbortSignal): AsyncIterable<Chunk> {
		const sinceArgs = config.since ? ["-f", `since=${config.since}`] : [];
		const items = await ghApi(
			this.#execFn,
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
			const metadata: Record<string, string> = {
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
			};

			const documentId = `${repo}#${number}`;
			const documentVersionId = String(rec.updated_at ?? rec.created_at ?? "");

			const chunks = chunkMarkdown(content, {
				chunkSize: GITHUB_CHUNK_SIZE,
				source: `${repo}#${number}`,
				sourceUrl: String(rec.html_url ?? ""),
				timestamp: String(rec.updated_at ?? rec.created_at ?? ""),
				metadata,
				documentId,
				documentVersionId,
			});

			for (const chunk of chunks) {
				const out: Chunk = { ...chunk, sourceType: "github-issue" };
				if (chunk.chunkIndex === 0) out.rawContent = content;
				yield out;
			}
		}
	}

	async *#ingestPulls(config: GitHubAdapterConfig, signal?: AbortSignal): AsyncIterable<Chunk> {
		// /pulls does NOT support `since` param — no since args here
		const items = await ghApi(
			this.#execFn,
			`repos/${config.owner}/${config.repo}/pulls?state=all`,
			signal,
		);
		const repo = `${config.owner}/${config.repo}`;

		for (const item of items) {
			const rec = item as Record<string, unknown>;
			if (!rec.title && !rec.body) continue;

			// Client-side since filtering (pulls endpoint doesn't support since param)
			if (config.since) {
				const prDate = new Date(String(rec.updated_at ?? rec.created_at ?? ""));
				const sinceDate = new Date(config.since);
				if (prDate < sinceDate) continue;
			}

			const number = String(rec.number ?? "");
			const body = String(rec.body ?? "");
			const title = String(rec.title ?? "");
			const content = `# ${title}\n\n${body}`;
			const metadata: Record<string, string> = {
				number,
				state: String(rec.state ?? ""),
				merged: String(rec.merged ?? "false"),
				author: String((rec.user as Record<string, unknown>)?.login ?? ""),
				createdAt: String(rec.created_at ?? ""),
				updatedAt: String(rec.updated_at ?? ""),
			};

			const documentId = `${repo}#${number}`;
			const documentVersionId = String(rec.updated_at ?? rec.created_at ?? "");

			const chunks = chunkMarkdown(content, {
				chunkSize: GITHUB_CHUNK_SIZE,
				source: `${repo}#${number}`,
				sourceUrl: String(rec.html_url ?? ""),
				timestamp: String(rec.updated_at ?? rec.created_at ?? ""),
				metadata,
				documentId,
				documentVersionId,
			});

			for (const chunk of chunks) {
				const out: Chunk = { ...chunk, sourceType: "github-pr" };
				if (chunk.chunkIndex === 0) out.rawContent = content;
				yield out;
			}
		}
	}

	async #fetchPullNumbers(config: GitHubAdapterConfig, signal?: AbortSignal): Promise<number[]> {
		const items = await ghApi(
			this.#execFn,
			`repos/${config.owner}/${config.repo}/pulls?state=all`,
			signal,
		);
		return items
			.filter((item) => {
				if (!config.since) return true;
				const rec = item as Record<string, unknown>;
				const prDate = new Date(String(rec.updated_at ?? rec.created_at ?? ""));
				return prDate >= new Date(config.since);
			})
			.map((item) => (item as Record<string, unknown>).number)
			.filter((n): n is number => typeof n === "number");
	}

	async *#ingestPrComments(
		config: GitHubAdapterConfig,
		prNumber: number,
		signal?: AbortSignal,
	): AsyncIterable<Chunk> {
		const items = await ghApi(
			this.#execFn,
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
			const metadata: Record<string, string> = {
				commentId,
				parentPr: String(prNumber),
				author: String((rec.user as Record<string, unknown>)?.login ?? ""),
				createdAt: String(rec.created_at ?? ""),
			};

			const documentId = `${repo}#${prNumber}/comment/${commentId}`;
			const documentVersionId = String(rec.updated_at ?? rec.created_at ?? "");

			const chunks = chunkMarkdown(body, {
				chunkSize: GITHUB_CHUNK_SIZE,
				source: `${repo}#${prNumber}`,
				sourceUrl: String(rec.html_url ?? ""),
				timestamp: String(rec.updated_at ?? rec.created_at ?? ""),
				metadata,
				documentId,
				documentVersionId,
			});

			for (const chunk of chunks) {
				const out: Chunk = { ...chunk, sourceType: "github-pr-comment" };
				if (chunk.chunkIndex === 0) out.rawContent = body;
				yield out;
			}
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
				const metadata: Record<string, string> = {
					number,
					author: String((node.author as Record<string, unknown>)?.login ?? ""),
					category: String((node.category as Record<string, unknown>)?.name ?? ""),
					createdAt: String(node.createdAt ?? ""),
				};

				const documentId = `${repo}/discussions/${number}`;
				const documentVersionId = String(node.createdAt ?? "");

				const chunks = chunkMarkdown(content, {
					chunkSize: GITHUB_CHUNK_SIZE,
					source: `${repo}/discussions/${number}`,
					sourceUrl: String(node.url ?? ""),
					timestamp: String(node.createdAt ?? ""),
					metadata,
					documentId,
					documentVersionId,
				});

				for (const chunk of chunks) {
					const out: Chunk = { ...chunk, sourceType: "github-discussion" };
					if (chunk.chunkIndex === 0) out.rawContent = content;
					yield out;
				}
			}

			hasNextPage = pageInfo?.hasNextPage ?? false;
			cursor = pageInfo?.endCursor ?? null;
		}
	}
}

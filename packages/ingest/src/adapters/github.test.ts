import { GitHubCliMissingError, GitHubNotFoundError, GitHubRateLimitError } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import type { ExecFn, GitHubAdapterConfig } from "./github/index.js";
import { GitHubAdapter } from "./github/index.js";

function mockExec(responses: Array<{ stdout?: string; stderr?: string; error?: boolean }>): ExecFn {
	let callIndex = 0;
	return async (_cmd: string, _args: string[], _signal?: AbortSignal) => {
		const resp = responses[callIndex++];
		if (!resp) throw new Error("No more mock responses");
		if (resp.error) {
			const err = new Error(resp.stderr ?? "mock error") as Error & { stderr: string };
			err.stderr = resp.stderr ?? "";
			throw err;
		}
		return { stdout: resp.stdout ?? "[]", stderr: resp.stderr ?? "" };
	};
}

const MOCK_ISSUES = JSON.stringify([
	{
		number: 1,
		title: "Bug report",
		body: "Something is broken. Refs #2 for context.",
		state: "open",
		html_url: "https://github.com/test/repo/issues/1",
		labels: [{ name: "bug" }, { name: "priority" }],
		user: { login: "alice" },
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-03-01T00:00:00Z",
	},
	{
		number: 2,
		title: "Feature request",
		body: "We need a new feature. Closes #1.",
		state: "closed",
		html_url: "https://github.com/test/repo/issues/2",
		labels: [],
		user: { login: "bob" },
		created_at: "2026-01-02T00:00:00Z",
		updated_at: "2026-03-02T00:00:00Z",
	},
	{
		number: 3,
		title: "PR included in issues",
		body: "This is actually a PR",
		state: "open",
		pull_request: { url: "https://api.github.com/repos/test/repo/pulls/3" },
		html_url: "https://github.com/test/repo/pull/3",
		labels: [],
		user: { login: "charlie" },
		created_at: "2026-01-03T00:00:00Z",
		updated_at: "2026-03-03T00:00:00Z",
	},
]);

const MOCK_PULLS = JSON.stringify([
	{
		number: 3,
		title: "Add feature",
		body: "Implements #2. Refs #1 for original report.",
		state: "closed",
		merged: true,
		html_url: "https://github.com/test/repo/pull/3",
		user: { login: "charlie" },
		created_at: "2026-02-01T00:00:00Z",
		updated_at: "2026-03-01T00:00:00Z",
	},
]);

const MOCK_COMMENTS = JSON.stringify([
	{
		id: 100,
		body: "Good approach, but consider #1 edge case.",
		html_url: "https://github.com/test/repo/pull/3#comment-100",
		user: { login: "alice" },
		created_at: "2026-02-02T00:00:00Z",
		updated_at: "2026-02-02T00:00:00Z",
	},
]);

describe("GitHubAdapter", () => {
	it("parseConfig validates owner/repo format", () => {
		const adapter = new GitHubAdapter();
		const config = adapter.parseConfig({ source: "test/repo" });
		expect(config.owner).toBe("test");
		expect(config.repo).toBe("repo");
	});

	it("parseConfig rejects invalid source", () => {
		const adapter = new GitHubAdapter();
		expect(() => adapter.parseConfig({ source: "noslash" })).toThrow();
	});
});

describe("GitHubAdapter: issue ingestion", () => {
	it("produces github-issue chunks with correct metadata", async () => {
		const exec = mockExec([
			{ stdout: MOCK_ISSUES },
			{ stdout: MOCK_PULLS },
			{ stdout: MOCK_PULLS },
			{ stdout: MOCK_COMMENTS },
		]);
		const adapter = new GitHubAdapter(exec);
		const config = adapter.parseConfig({ source: "test/repo" });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		const issueChunks = chunks.filter((c) => c.sourceType === "github-issue");
		expect(issueChunks.length).toBe(2);
		expect(issueChunks[0]?.source).toBe("test/repo#1");
		expect(issueChunks[0]?.metadata.number).toBe("1");
		expect(issueChunks[0]?.metadata.state).toBe("open");
		expect(issueChunks[0]?.metadata.labels).toBe("bug,priority");
		expect(issueChunks[0]?.metadata.author).toBe("alice");
	});

	it("filters out PRs from issues endpoint", async () => {
		const exec = mockExec([
			{ stdout: MOCK_ISSUES },
			{ stdout: MOCK_PULLS },
			{ stdout: MOCK_PULLS },
			{ stdout: MOCK_COMMENTS },
		]);
		const adapter = new GitHubAdapter(exec);
		const config = adapter.parseConfig({ source: "test/repo" });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		const issueChunks = chunks.filter((c) => c.sourceType === "github-issue");
		expect(issueChunks.every((c) => !c.content.includes("PR included"))).toBe(true);
	});
});

describe("GitHubAdapter: PR ingestion", () => {
	it("produces github-pr chunks with correct metadata", async () => {
		const exec = mockExec([
			{ stdout: "[]" },
			{ stdout: MOCK_PULLS },
			{ stdout: MOCK_PULLS },
			{ stdout: MOCK_COMMENTS },
		]);
		const adapter = new GitHubAdapter(exec);
		const config = adapter.parseConfig({ source: "test/repo" });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		const prChunks = chunks.filter((c) => c.sourceType === "github-pr");
		expect(prChunks.length).toBe(1);
		expect(prChunks[0]?.source).toBe("test/repo#3");
		expect(prChunks[0]?.metadata.merged).toBe("true");
	});
});

describe("GitHubAdapter: PR comment ingestion", () => {
	it("produces github-pr-comment chunks linked to parent PR", async () => {
		const exec = mockExec([
			{ stdout: "[]" },
			{ stdout: MOCK_PULLS },
			{ stdout: MOCK_PULLS },
			{ stdout: MOCK_COMMENTS },
		]);
		const adapter = new GitHubAdapter(exec);
		const config = adapter.parseConfig({ source: "test/repo" });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		const commentChunks = chunks.filter((c) => c.sourceType === "github-pr-comment");
		expect(commentChunks.length).toBe(1);
		expect(commentChunks[0]?.source).toBe("test/repo#3");
		expect(commentChunks[0]?.metadata.parentPr).toBe("3");
		expect(commentChunks[0]?.metadata.commentId).toBe("100");
	});
});

describe("GitHubAdapter: edge extraction", () => {
	it("extracts cross-reference edges from issue/PR bodies", async () => {
		const exec = mockExec([
			{ stdout: MOCK_ISSUES },
			{ stdout: MOCK_PULLS },
			{ stdout: MOCK_PULLS },
			{ stdout: MOCK_COMMENTS },
		]);
		const adapter = new GitHubAdapter(exec);
		const config = adapter.parseConfig({ source: "test/repo" });

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}

		const edges = await adapter.extractEdges(chunks);
		expect(edges.length).toBeGreaterThan(0);

		const hasRefs = edges.some((e) => e.type === "references");
		const hasCloses = edges.some((e) => e.type === "closes");
		expect(hasRefs || hasCloses).toBe(true);
	});
});

describe("GitHubAdapter: rate limit handling", () => {
	it("retries on rate limit and succeeds", async () => {
		let callCount = 0;
		const exec: ExecFn = async () => {
			callCount++;
			if (callCount === 1) {
				const err = new Error("rate limit exceeded") as Error & { stderr: string };
				err.stderr = "API rate limit exceeded. Retry-After: 0";
				throw err;
			}
			return { stdout: "[]", stderr: "" };
		};
		const adapter = new GitHubAdapter(exec);
		const config: GitHubAdapterConfig = { owner: "test", repo: "repo", types: ["issues"] };

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}
		expect(callCount).toBe(2);
	});

	it("throws GitHubRateLimitError when max wait exceeded", async () => {
		const exec: ExecFn = async () => {
			const err = new Error("rate limit") as Error & { stderr: string };
			err.stderr = "API rate limit exceeded. Retry-After: 999";
			throw err;
		};
		const adapter = new GitHubAdapter(exec);
		const config: GitHubAdapterConfig = { owner: "test", repo: "repo", types: ["issues"] };

		await expect(async () => {
			for await (const _chunk of adapter.ingest(config)) {
				// drain
			}
		}).rejects.toThrow(GitHubRateLimitError);
	});

	it("cancels during backoff when AbortSignal fires", async () => {
		const controller = new AbortController();
		const exec: ExecFn = async () => {
			const err = new Error("rate limit") as Error & { stderr: string };
			err.stderr = "API rate limit exceeded";
			throw err;
		};
		const adapter = new GitHubAdapter(exec);
		const config: GitHubAdapterConfig = { owner: "test", repo: "repo", types: ["issues"] };

		setTimeout(() => controller.abort(), 50);

		await expect(async () => {
			for await (const _chunk of adapter.ingest(config, controller.signal)) {
				// drain
			}
		}).rejects.toThrow();
	});
});

describe("GitHubAdapter: error handling", () => {
	it("throws GitHubNotFoundError for 404", async () => {
		const exec = mockExec([{ stderr: "Not Found (HTTP 404)", error: true }]);
		const adapter = new GitHubAdapter(exec);
		const config: GitHubAdapterConfig = { owner: "test", repo: "nope", types: ["issues"] };

		await expect(async () => {
			for await (const _chunk of adapter.ingest(config)) {
			}
		}).rejects.toThrow(GitHubNotFoundError);
	});

	it("throws GitHubCliMissingError when gh not found", async () => {
		const exec = mockExec([{ stderr: "ENOENT", error: true }]);
		const adapter = new GitHubAdapter(exec);
		const config: GitHubAdapterConfig = { owner: "test", repo: "repo", types: ["issues"] };

		await expect(async () => {
			for await (const _chunk of adapter.ingest(config)) {
			}
		}).rejects.toThrow(GitHubCliMissingError);
	});

	it("throws GitHubApiError for malformed JSON", async () => {
		const exec = mockExec([{ stdout: "not json {{{" }]);
		const adapter = new GitHubAdapter(exec);
		const config: GitHubAdapterConfig = { owner: "test", repo: "repo", types: ["issues"] };

		await expect(async () => {
			for await (const _chunk of adapter.ingest(config)) {
			}
		}).rejects.toThrow();
	});

	it("skips items with empty body", async () => {
		const emptyIssues = JSON.stringify([
			{ number: 1, title: "", body: null, state: "open", labels: [], user: { login: "x" } },
		]);
		const exec = mockExec([{ stdout: emptyIssues }]);
		const adapter = new GitHubAdapter(exec);
		const config: GitHubAdapterConfig = { owner: "test", repo: "repo", types: ["issues"] };

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}
		expect(chunks).toHaveLength(0);
	});
});

describe("GitHubAdapter: discussions", () => {
	it("skips gracefully when discussions not available", async () => {
		const exec: ExecFn = async (_cmd, args) => {
			if (args.includes("graphql")) {
				throw new Error("discussions not enabled");
			}
			return { stdout: "[]", stderr: "" };
		};
		const adapter = new GitHubAdapter(exec);
		const config: GitHubAdapterConfig = { owner: "test", repo: "repo", types: ["discussions"] };

		const chunks = [];
		for await (const chunk of adapter.ingest(config)) {
			chunks.push(chunk);
		}
		expect(chunks).toHaveLength(0);
	});
});

import { describe, expect, it } from "vitest";
import { GithubIssueChunker } from "./github-issue-chunker.js";

const chunker = new GithubIssueChunker();

function makeIssueDoc(overrides: Partial<Parameters<typeof makeDoc>[0]> = {}) {
	return makeDoc({
		number: "42",
		title: "Fix the widget",
		labels: "bug,priority:high",
		body: "The widget is broken.\n\nSteps to reproduce:\n1. Click the widget\n2. Observe crash",
		...overrides,
	});
}

function makeDoc({
	number,
	title,
	labels,
	body,
}: {
	number: string;
	title: string;
	labels: string;
	body: string;
}) {
	const content = `# ${title}\n\n${body}`;
	return {
		documentId: `owner/repo#${number}`,
		documentVersionId: "2024-01-01T00:00:00Z",
		content,
		sourceType: "github-issue",
		source: `owner/repo#${number}`,
		sourceUrl: `https://github.com/owner/repo/issues/${number}`,
		timestamp: "2024-01-01T00:00:00Z",
		metadata: {
			number,
			labels,
			state: "open",
			author: "alice",
			createdAt: "2024-01-01T00:00:00Z",
			updatedAt: "2024-01-01T00:00:00Z",
		},
	};
}

describe("GithubIssueChunker", () => {
	it("has name=github-issue and a version", () => {
		expect(chunker.name).toBe("github-issue");
		expect(chunker.version).toBeTruthy();
	});

	it("produces at least one chunk for a simple issue", () => {
		const doc = makeIssueDoc();
		const chunks = chunker.chunk(doc);
		expect(chunks.length).toBeGreaterThan(0);
	});

	it("every chunk contains owner/repo, issue number, and title", () => {
		// Use a large body so the issue gets split into multiple chunks
		const longBody = "Details: ".repeat(1000);
		const doc = makeIssueDoc({ body: longBody });
		const chunks = chunker.chunk(doc, { maxChunkChars: 500 });
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			// Format avoids "#42" to prevent spurious self-reference edges from regex extractor
			expect(chunk.content).toContain("owner/repo issue 42");
			expect(chunk.content).toContain("Fix the widget");
		}
	});

	it("every chunk contains the labels when present", () => {
		const longBody = "Detailed description. ".repeat(500);
		const doc = makeIssueDoc({ body: longBody });
		const chunks = chunker.chunk(doc, { maxChunkChars: 500 });
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.content).toContain("bug");
		}
	});

	it("preserves sourceType as github-issue", () => {
		const doc = makeIssueDoc();
		const chunks = chunker.chunk(doc);
		for (const chunk of chunks) {
			expect(chunk.sourceType).toBe("github-issue");
		}
	});

	it("first chunk includes rawContent set to the full document content", () => {
		const doc = makeIssueDoc();
		const chunks = chunker.chunk(doc);
		expect(chunks[0]?.rawContent).toBe(doc.content);
	});

	it("does not crash on empty body", () => {
		const doc = makeIssueDoc({ body: "" });
		expect(() => chunker.chunk(doc)).not.toThrow();
	});

	it("chunk with no labels omits the labels line", () => {
		const doc = makeIssueDoc({ labels: "" });
		const chunks = chunker.chunk(doc);
		expect(chunks[0]?.content).not.toContain("Labels:");
	});

	it("uses maxChunkChars as the chunk size when chunkSize is not set", () => {
		// MarkdownChunker only reads chunkSize; maxChunkChars must be mapped through
		const longBody = "word ".repeat(2000); // 10 000 chars, no markdown structure
		const doc = makeIssueDoc({ body: longBody });
		const chunksSmall = chunker.chunk(doc, { maxChunkChars: 512 });
		const chunksLarge = chunker.chunk(doc, { maxChunkChars: 4000 });
		// More chunks at smaller size means maxChunkChars is being respected
		expect(chunksSmall.length).toBeGreaterThan(chunksLarge.length);
		// The body chunks (title is always its own small chunk) should be ~4000 chars
		const bodyChunksLarge = chunksLarge.filter((c) => c.content.includes("word"));
		expect(bodyChunksLarge[0]?.content.length).toBeGreaterThan(512);
	});

	it("header labels use 'PR' for github-pr sourceType", () => {
		const doc = { ...makeIssueDoc(), sourceType: "github-pr" };
		const chunks = chunker.chunk(doc);
		expect(chunks[0]?.content).toContain(" PR ");
		expect(chunks[0]?.content).not.toContain(" issue ");
	});

	it("header labels use 'discussion' for github-discussion sourceType", () => {
		const doc = { ...makeIssueDoc(), sourceType: "github-discussion" };
		const chunks = chunker.chunk(doc);
		expect(chunks[0]?.content).toContain(" discussion ");
		expect(chunks[0]?.content).not.toContain(" issue ");
	});

	it("header labels use 'issue' for github-issue sourceType", () => {
		const doc = makeIssueDoc(); // sourceType is github-issue
		const chunks = chunker.chunk(doc);
		expect(chunks[0]?.content).toContain(" issue ");
	});

	it("discussion source format (owner/repo/discussions/N) extracts repo correctly", () => {
		const doc = {
			documentId: "owner/repo/discussions/7",
			documentVersionId: "2024-01-01T00:00:00Z",
			content: "# Discussion title\n\nSome discussion content",
			sourceType: "github-discussion",
			source: "owner/repo/discussions/7",
			sourceUrl: "https://github.com/owner/repo/discussions/7",
			timestamp: "2024-01-01T00:00:00Z",
			metadata: {
				number: "7",
				labels: "",
				state: "open",
				author: "bob",
				createdAt: "2024-01-01T00:00:00Z",
				updatedAt: "2024-01-01T00:00:00Z",
			},
		};
		const chunks = chunker.chunk(doc);
		// Header should say "owner/repo discussion 7: ..." not "owner/repo/discussions/7 discussion ..."
		expect(chunks[0]?.content).toContain("owner/repo discussion 7");
		expect(chunks[0]?.content).not.toContain("owner/repo/discussions/7");
	});
});

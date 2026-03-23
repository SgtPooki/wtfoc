import type { ArtifactSummaryEntry, CollectionRevision } from "@wtfoc/common";
import { describe, expect, it } from "vitest";
import { computeRevisionDiff, generateContentIdentity } from "./diff.js";

function makeSummary(id: string, contentIdentity: string): ArtifactSummaryEntry {
	return {
		artifactId: id,
		artifactRole: "segment",
		sourceScope: "repo",
		contentIdentity,
		storageId: id,
	};
}

function makeRevision(summaries: ArtifactSummaryEntry[]): CollectionRevision {
	return {
		schemaVersion: 1,
		revisionId: `rev-${Date.now()}`,
		collectionId: "test-col",
		prevRevisionId: null,
		artifactSummaries: summaries,
		segmentRefs: summaries.map((s) => s.storageId),
		bundleRefs: [],
		provenance: [],
		createdAt: new Date().toISOString(),
		publishedBy: "test",
	};
}

describe("computeRevisionDiff", () => {
	it("detects added artifacts", () => {
		const left = makeRevision([]);
		const right = makeRevision([makeSummary("seg-1", "cid-1")]);

		const diff = computeRevisionDiff(left, right);

		expect(diff.counts.added).toBe(1);
		expect(diff.counts.removed).toBe(0);
		expect(diff.counts.unchanged).toBe(0);
		expect(diff.added[0]?.artifactId).toBe("seg-1");
	});

	it("detects removed artifacts", () => {
		const left = makeRevision([makeSummary("seg-1", "cid-1")]);
		const right = makeRevision([]);

		const diff = computeRevisionDiff(left, right);

		expect(diff.counts.removed).toBe(1);
		expect(diff.counts.added).toBe(0);
		expect(diff.removed[0]?.artifactId).toBe("seg-1");
	});

	it("detects unchanged artifacts by contentIdentity", () => {
		const left = makeRevision([makeSummary("seg-1", "cid-same")]);
		const right = makeRevision([makeSummary("seg-1", "cid-same")]);

		const diff = computeRevisionDiff(left, right);

		expect(diff.counts.unchanged).toBe(1);
		expect(diff.counts.added).toBe(0);
		expect(diff.counts.removed).toBe(0);
	});

	it("detects modified artifacts (same id, different contentIdentity)", () => {
		const left = makeRevision([makeSummary("seg-1", "cid-old")]);
		const right = makeRevision([makeSummary("seg-1", "cid-new")]);

		const diff = computeRevisionDiff(left, right);

		expect(diff.counts.added).toBe(1);
		expect(diff.counts.removed).toBe(1);
		expect(diff.counts.unchanged).toBe(0);
	});

	it("returns empty diff for identical revisions", () => {
		const summaries = [makeSummary("seg-1", "cid-1"), makeSummary("seg-2", "cid-2")];
		const left = makeRevision(summaries);
		const right = makeRevision(summaries);

		const diff = computeRevisionDiff(left, right);

		expect(diff.counts.added).toBe(0);
		expect(diff.counts.removed).toBe(0);
		expect(diff.counts.unchanged).toBe(2);
	});

	it("handles complex mix of added, removed, and unchanged", () => {
		const left = makeRevision([
			makeSummary("seg-1", "cid-1"),
			makeSummary("seg-2", "cid-2"),
			makeSummary("seg-3", "cid-3"),
		]);
		const right = makeRevision([
			makeSummary("seg-2", "cid-2"),
			makeSummary("seg-4", "cid-4"),
		]);

		const diff = computeRevisionDiff(left, right);

		expect(diff.counts.unchanged).toBe(1);
		expect(diff.counts.added).toBe(1);
		expect(diff.counts.removed).toBe(2);
	});
});

describe("generateContentIdentity", () => {
	it("returns ipfsCid when available", () => {
		const data = new TextEncoder().encode("test");
		expect(generateContentIdentity(data, "bafytest123")).toBe("bafytest123");
	});

	it("returns SHA-256 hex when no ipfsCid", () => {
		const data = new TextEncoder().encode("test content");
		const identity = generateContentIdentity(data);
		expect(identity).toMatch(/^[a-f0-9]{64}$/);
	});

	it("is deterministic for same input", () => {
		const data = new TextEncoder().encode("deterministic");
		const id1 = generateContentIdentity(data);
		const id2 = generateContentIdentity(data);
		expect(id1).toBe(id2);
	});

	it("differs for different input", () => {
		const data1 = new TextEncoder().encode("content-a");
		const data2 = new TextEncoder().encode("content-b");
		expect(generateContentIdentity(data1)).not.toBe(generateContentIdentity(data2));
	});
});

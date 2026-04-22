import { createHash } from "node:crypto";
import type { CollectionHead, StorageBackend } from "@wtfoc/common";
import type { CidResolvedCollection } from "@wtfoc/store";
import { serializeSegment } from "@wtfoc/store";
import { describe, expect, it } from "vitest";
import { runVerifyCollection } from "./verify-collection.js";

function makeSegmentBytes(id: string, chunkCount: number): Uint8Array {
	const bytes = serializeSegment({
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 3,
		chunks: Array.from({ length: chunkCount }, (_, i) => ({
			id: `chunk-${id}-${i}`,
			storageId: `chunk-${id}-${i}`,
			content: `content ${i}`,
			embedding: [0.1, 0.2, 0.3],
			terms: [],
			source: "test",
			sourceType: "code",
			metadata: {},
		})),
		edges: [],
	});
	return bytes;
}

function makeManifest(segments: Array<{ id: string; chunkCount: number }>): CollectionHead {
	return {
		collectionId: "test",
		name: "test-collection",
		schemaVersion: 1,
		embeddingModel: "test",
		embeddingDimensions: 3,
		totalChunks: segments.reduce((acc, s) => acc + s.chunkCount, 0),
		segments: segments.map((s) => ({
			id: s.id,
			chunkCount: s.chunkCount,
			sourceTypes: ["code"],
		})),
		derivedEdgeLayers: [],
		prevHeadId: null,
		currentRevisionId: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
	};
}

function resolverFrom(
	manifest: CollectionHead,
	segmentBytes: Map<string, Uint8Array>,
	downloadOverrides?: Map<string, () => Promise<Uint8Array>>,
): (cid: string) => Promise<CidResolvedCollection> {
	const storage: StorageBackend = {
		async download(id: string): Promise<Uint8Array> {
			const override = downloadOverrides?.get(id);
			if (override) return override();
			const bytes = segmentBytes.get(id);
			if (!bytes) throw new Error(`not found: ${id}`);
			return bytes;
		},
		async upload(): Promise<never> {
			throw new Error("read-only");
		},
	};
	return async (_cid: string) => ({
		manifest,
		storage,
		sidecarCid: () => undefined,
		close: async () => {},
	});
}

describe("runVerifyCollection", () => {
	it("REMOTELY VERIFIED when every artifact resolves, hashes, and parses", async () => {
		const bytesA = makeSegmentBytes("a", 3);
		const bytesB = makeSegmentBytes("b", 5);
		const idA = createHash("sha256").update(bytesA).digest("hex");
		const idB = createHash("sha256").update(bytesB).digest("hex");
		const manifest = makeManifest([
			{ id: idA, chunkCount: 3 },
			{ id: idB, chunkCount: 5 },
		]);
		const map = new Map([
			[idA, bytesA],
			[idB, bytesB],
		]);
		const report = await runVerifyCollection("bafytest", {
			retryDelaysMs: [0, 0, 0],
			resolver: resolverFrom(manifest, map),
		});
		expect(report.verdict).toBe("REMOTELY VERIFIED");
		expect(report.collectionName).toBe("test-collection");
	});

	it("INCONSISTENT when a segment's bytes hash to a different id than the manifest claims", async () => {
		const bytesA = makeSegmentBytes("a", 3);
		const fakeId = "a".repeat(64); // legal sha256 shape, wrong content
		const manifest = makeManifest([{ id: fakeId, chunkCount: 3 }]);
		const map = new Map([[fakeId, bytesA]]);
		const report = await runVerifyCollection("bafytest", {
			retryDelaysMs: [0, 0, 0],
			resolver: resolverFrom(manifest, map),
		});
		expect(report.verdict).toBe("INCONSISTENT");
		expect(report.checks.some((c) => c.name.endsWith("-hash"))).toBe(true);
	});

	it("INCONSISTENT when chunkCount disagrees with segment contents", async () => {
		const bytesA = makeSegmentBytes("a", 3);
		const idA = createHash("sha256").update(bytesA).digest("hex");
		const manifest = makeManifest([{ id: idA, chunkCount: 99 }]);
		const map = new Map([[idA, bytesA]]);
		const report = await runVerifyCollection("bafytest", {
			retryDelaysMs: [0, 0, 0],
			resolver: resolverFrom(manifest, map),
		});
		expect(report.verdict).toBe("INCONSISTENT");
		expect(report.checks.some((c) => c.name.endsWith("-chunkCount"))).toBe(true);
	});

	it("UNVERIFIED when a segment cannot be fetched after retries", async () => {
		const bytesA = makeSegmentBytes("a", 3);
		const idA = createHash("sha256").update(bytesA).digest("hex");
		const manifest = makeManifest([{ id: idA, chunkCount: 3 }]);
		const overrides = new Map([
			[
				idA,
				async () => {
					throw new Error("network down");
				},
			],
		]);
		const report = await runVerifyCollection("bafytest", {
			retryDelaysMs: [0, 0, 0],
			resolver: resolverFrom(manifest, new Map(), overrides),
		});
		expect(report.verdict).toBe("UNVERIFIED");
		const reachCheck = report.checks.find((c) => c.name === "segments-reachable");
		expect(reachCheck?.status).toBe("fetch-fail");
	});

	it("INCONSISTENT beats UNVERIFIED when both are present (content failure is the stronger signal)", async () => {
		const bytesA = makeSegmentBytes("a", 3);
		const bytesB = makeSegmentBytes("b", 5);
		const fakeId = "a".repeat(64); // content-fail on A
		const idB = createHash("sha256").update(bytesB).digest("hex");
		const manifest = makeManifest([
			{ id: fakeId, chunkCount: 3 },
			{ id: idB, chunkCount: 5 },
		]);
		const map = new Map([[fakeId, bytesA]]);
		const overrides = new Map([
			[
				idB,
				async () => {
					throw new Error("timeout");
				},
			],
		]);
		const report = await runVerifyCollection("bafytest", {
			retryDelaysMs: [0, 0, 0],
			resolver: resolverFrom(manifest, map, overrides),
		});
		expect(report.verdict).toBe("INCONSISTENT");
	});
});

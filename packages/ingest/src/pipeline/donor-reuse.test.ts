import type { Chunk, DocumentCatalog } from "@wtfoc/common";
import { describe, expect, it, vi } from "vitest";
import { createEmptyArchiveIndex } from "../raw-source-archive.js";
import { reuseDonorSources } from "./donor-reuse.js";
import type { PipelineState } from "./types.js";

function makeState(): PipelineState {
	return {
		knownFingerprints: new Set(),
		knownChunkIds: new Set(),
		archiveIndex: createEmptyArchiveIndex("test-col"),
		catalog: { schemaVersion: 1, collectionId: "test-col", documents: {} },
		catalogPendingChunks: new Map(),
		batch: [],
		batchNumber: 0,
		stats: {
			chunksIngested: 0,
			chunksSkipped: 0,
			chunksFiltered: 0,
			docsSuperseded: 0,
			archivedCount: 0,
			rechunkedCount: 0,
			reusedFromDonors: 0,
			donorCollectionNames: [],
			batchesWritten: 0,
		},
		maxTimestamp: "",
	};
}

function makeDonorChunk(overrides: Partial<Chunk> = {}): Chunk {
	return {
		id: "donor-c1",
		content: "donor content",
		sourceType: "code",
		source: "owner/repo",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: { filePath: "src/foo.ts" },
		documentId: "owner/repo/src/foo.ts",
		documentVersionId: "v1",
		rawContent: "full file content",
		...overrides,
	};
}

describe("reuseDonorSources", () => {
	it("returns immediately when sourceReuse is disabled", async () => {
		const state = makeState();
		await reuseDonorSources(state, {
			sourceReuse: false,
			isPartialRun: false,
			sourceKey: "repo:owner/repo",
			collectionName: "test-col",
			manifestDir: "/tmp",
			scanForReusable: vi.fn(),
			replayFromArchive: vi.fn(),
			readDonorCatalog: vi.fn(),
			archiveRawSource: vi.fn(),
			isArchived: vi.fn(),
			listProjects: vi.fn().mockResolvedValue([]),
			storage: {
				download: vi.fn().mockResolvedValue(new Uint8Array()),
				upload: vi.fn().mockResolvedValue({ id: "test" }),
			},
			uploadData: vi.fn(),
			log: vi.fn(),
		});
		expect(state.stats.reusedFromDonors).toBe(0);
	});

	it("scans donors, replays archives, and merges fingerprints", async () => {
		const state = makeState();
		const donorCatalog: DocumentCatalog = {
			schemaVersion: 1,
			collectionId: "donor-col",
			documents: {
				"owner/repo/src/foo.ts": {
					documentId: "owner/repo/src/foo.ts",
					currentVersionId: "v1",
					previousVersionIds: [],
					chunkIds: ["donor-c1"],
					supersededChunkIds: [],
					contentFingerprints: ["donor-fp1"],
					state: "active",
					mutability: "mutable-state",
					sourceType: "code",
					updatedAt: new Date().toISOString(),
				},
			},
		};

		const donorChunk = makeDonorChunk();
		async function* fakeReplay() {
			yield donorChunk;
		}

		await reuseDonorSources(state, {
			sourceReuse: true,
			isPartialRun: false,
			sourceKey: "repo:owner/repo",
			collectionName: "test-col",
			manifestDir: "/tmp",
			scanForReusable: vi.fn().mockResolvedValue({
				matches: [
					{
						collectionName: "donor-col",
						archiveEntries: [
							{
								documentId: "owner/repo/src/foo.ts",
								storageId: "s1",
								sourceKey: "repo:owner/repo",
							},
						],
					},
				],
			}),
			replayFromArchive: vi.fn().mockReturnValue(fakeReplay()),
			readDonorCatalog: vi.fn().mockResolvedValue(donorCatalog),
			archiveRawSource: vi.fn(),
			isArchived: vi.fn().mockReturnValue(false),
			listProjects: vi.fn().mockResolvedValue([]),
			storage: {
				download: vi.fn().mockResolvedValue(new Uint8Array()),
				upload: vi.fn().mockResolvedValue({ id: "test" }),
			},
			uploadData: vi.fn().mockResolvedValue("uploaded-id"),
			log: vi.fn(),
		});

		expect(state.stats.reusedFromDonors).toBe(1);
		expect(state.stats.donorCollectionNames).toContain("donor-col");
		expect(state.knownFingerprints.has("donor-fp1")).toBe(true);
		expect(state.knownChunkIds.has("donor-c1")).toBe(true);
	});

	it("skips when isPartialRun is true", async () => {
		const state = makeState();
		const scan = vi.fn();
		await reuseDonorSources(state, {
			sourceReuse: true,
			isPartialRun: true,
			sourceKey: "repo:owner/repo",
			collectionName: "test-col",
			manifestDir: "/tmp",
			scanForReusable: scan,
			replayFromArchive: vi.fn(),
			readDonorCatalog: vi.fn(),
			archiveRawSource: vi.fn(),
			isArchived: vi.fn(),
			listProjects: vi.fn().mockResolvedValue([]),
			storage: {
				download: vi.fn().mockResolvedValue(new Uint8Array()),
				upload: vi.fn().mockResolvedValue({ id: "test" }),
			},
			uploadData: vi.fn(),
			log: vi.fn(),
		});
		expect(scan).not.toHaveBeenCalled();
		expect(state.stats.reusedFromDonors).toBe(0);
	});
});

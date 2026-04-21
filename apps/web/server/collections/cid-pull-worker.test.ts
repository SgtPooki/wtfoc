/**
 * Handler-level tests for `registerCidPullHandler` and `runCidPullJob`
 * (#288 Phase 2 Slice A). Uses InMemoryJobQueue + InMemoryRepository + a
 * hand-rolled `CidPullDeps` fake — no real IPFS, no real local store.
 *
 * The invariants being pinned down:
 *  - collection row flips importing → ready only when every segment is in
 *    local storage AND the head has been written
 *  - cancel / failure at any boundary leaves status=import_failed and no head
 *  - retry after a failed pull succeeds (orphan blobs are fine)
 *  - the "one active mutating job per collection" unique slot is enforced
 *  - wallet scoping: another wallet can't see or cancel the job
 */
import type { CollectionHead, StorageBackend } from "@wtfoc/common";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../db/memory.js";
import { InMemoryJobQueue, JobCollectionBusyError } from "../jobs/in-memory.js";
import { type CidPullDeps, registerCidPullHandler } from "./cid-pull-worker.js";

const WALLET = "0xWallet1";
const OTHER_WALLET = "0xWallet2";

async function tick(ms = 5): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

function buildManifest(overrides: Partial<CollectionHead> = {}): CollectionHead {
	return {
		schemaVersion: 1,
		collectionId: "coll-abc",
		name: "test-collection",
		currentRevisionId: null,
		prevHeadId: null,
		segments: [
			{ id: "seg-1", sourceTypes: ["github"], chunkCount: 1 },
			{ id: "seg-2", sourceTypes: ["github"], chunkCount: 1 },
			{ id: "seg-3", sourceTypes: ["github"], chunkCount: 1 },
		],
		totalChunks: 3,
		embeddingModel: "nomic-embed-text",
		embeddingDimensions: 384,
		createdAt: "2026-04-20T00:00:00Z",
		updatedAt: "2026-04-20T00:00:00Z",
		...overrides,
	};
}

interface FakeDepsControls {
	downloadedSegments: string[];
	uploadedSegments: string[];
	putHeadCalls: Array<{ name: string; prev: string | null }>;
	failOnSegmentIndex: number | null;
	hangOnSegmentIndex: number | null;
	presentLocally: Set<string>;
	deps: CidPullDeps;
}

function buildFakeDeps(manifest: CollectionHead): FakeDepsControls {
	const downloadedSegments: string[] = [];
	const uploadedSegments: string[] = [];
	const putHeadCalls: Array<{ name: string; prev: string | null }> = [];
	const presentLocally = new Set<string>();
	let currentHeadId: string | null = null;

	const controls: FakeDepsControls = {
		downloadedSegments,
		uploadedSegments,
		putHeadCalls,
		failOnSegmentIndex: null,
		hangOnSegmentIndex: null,
		presentLocally,
		deps: undefined as unknown as CidPullDeps,
	};

	const storage: StorageBackend = {
		download: async (id, sig) => {
			sig?.throwIfAborted();
			const idx = manifest.segments.findIndex((s) => s.id === id);
			if (controls.failOnSegmentIndex === idx) {
				throw new Error(`segment ${id} missing`);
			}
			if (controls.hangOnSegmentIndex === idx) {
				await new Promise<Uint8Array>((_resolve, reject) => {
					sig?.addEventListener("abort", () => reject(new Error("aborted")));
				});
			}
			downloadedSegments.push(id);
			return new Uint8Array([1, 2, 3]);
		},
		upload: async () => {
			throw new Error("remote upload not expected");
		},
	};

	controls.deps = {
		resolveCollectionByCid: async () => ({ manifest, storage }),
		verifyLocal: async (id) => presentLocally.has(id),
		uploadLocal: async (_bytes) => {
			// Record the most recently downloaded segment as persisted.
			const last = downloadedSegments[downloadedSegments.length - 1];
			if (last) {
				uploadedSegments.push(last);
				presentLocally.add(last);
			}
		},
		currentLocalHeadId: async () => currentHeadId,
		putLocalHead: async (name, _manifest, prev) => {
			putHeadCalls.push({ name, prev });
			currentHeadId = `head-${putHeadCalls.length}`;
		},
	};

	return controls;
}

async function setupQueue(repo: InMemoryRepository, controls: FakeDepsControls) {
	const queue = new InMemoryJobQueue();
	registerCidPullHandler(queue, repo, async () => controls.deps);
	await queue.start();
	return queue;
}

async function seedImportingCollection(repo: InMemoryRepository, name: string) {
	const created = await repo.createCollection({
		name,
		walletAddress: WALLET,
		sources: [],
	});
	await repo.updateCollectionStatus(created.id, "importing");
	return created;
}

describe("cid-pull-worker", () => {
	let repo: InMemoryRepository;

	beforeEach(() => {
		repo = new InMemoryRepository();
	});

	it("happy path — downloads every segment, writes head, marks collection ready", async () => {
		const manifest = buildManifest();
		const controls = buildFakeDeps(manifest);
		const queue = await setupQueue(repo, controls);
		const collection = await seedImportingCollection(repo, "pull-happy");

		const job = await queue.enqueue({
			type: "cid-pull",
			walletAddress: WALLET,
			collectionId: collection.id,
			payload: {
				collectionId: collection.id,
				manifestCid: "bafymanifest",
				collectionName: "pull-happy",
			},
		});
		await tick();

		const done = await queue.get(job.id, WALLET);
		expect(done?.status).toBe("succeeded");
		expect(done?.phase).toBe("persisting manifest");
		expect(done?.current).toBe(manifest.segments.length);
		expect(done?.total).toBe(manifest.segments.length);
		expect(controls.downloadedSegments).toEqual(["seg-1", "seg-2", "seg-3"]);
		expect(controls.uploadedSegments).toEqual(["seg-1", "seg-2", "seg-3"]);
		expect(controls.putHeadCalls).toHaveLength(1);
		const after = await repo.getCollection(collection.id);
		expect(after?.status).toBe("ready");
		expect(after?.manifestCid).toBe("bafymanifest");
		expect(after?.segmentCount).toBe(manifest.segments.length);
		await queue.stop();
	});

	it("skips segments already present locally (retry-after-fail path)", async () => {
		const manifest = buildManifest();
		const controls = buildFakeDeps(manifest);
		// Simulate a prior partial import that already cached seg-1 and seg-2.
		controls.presentLocally.add("seg-1");
		controls.presentLocally.add("seg-2");
		const queue = await setupQueue(repo, controls);
		const collection = await seedImportingCollection(repo, "pull-retry");

		await queue.enqueue({
			type: "cid-pull",
			walletAddress: WALLET,
			collectionId: collection.id,
			payload: {
				collectionId: collection.id,
				manifestCid: "bafymanifest",
				collectionName: "pull-retry",
			},
		});
		await tick();

		// Only seg-3 needed to be downloaded; seg-1/seg-2 were satisfied by verifyLocal.
		expect(controls.downloadedSegments).toEqual(["seg-3"]);
		expect(controls.uploadedSegments).toEqual(["seg-3"]);
		const after = await repo.getCollection(collection.id);
		expect(after?.status).toBe("ready");
		await queue.stop();
	});

	it("mid-download failure leaves collection import_failed, no head written", async () => {
		const manifest = buildManifest();
		const controls = buildFakeDeps(manifest);
		controls.failOnSegmentIndex = 1; // fail on seg-2
		const queue = await setupQueue(repo, controls);
		const collection = await seedImportingCollection(repo, "pull-fail");

		const job = await queue.enqueue({
			type: "cid-pull",
			walletAddress: WALLET,
			collectionId: collection.id,
			payload: {
				collectionId: collection.id,
				manifestCid: "bafymanifest",
				collectionName: "pull-fail",
			},
		});
		await tick();

		const done = await queue.get(job.id, WALLET);
		expect(done?.status).toBe("failed");
		expect(done?.errorMessage).toMatch(/seg-2/);
		expect(controls.putHeadCalls).toHaveLength(0);
		const after = await repo.getCollection(collection.id);
		expect(after?.status).toBe("import_failed");
		expect(after?.manifestCid).toBeNull();
		await queue.stop();
	});

	it("cancel mid-download aborts, sets cancelled, leaves collection import_failed + no head", async () => {
		const manifest = buildManifest();
		const controls = buildFakeDeps(manifest);
		controls.hangOnSegmentIndex = 1; // hang on seg-2 until abort
		const queue = await setupQueue(repo, controls);
		const collection = await seedImportingCollection(repo, "pull-cancel");

		const job = await queue.enqueue({
			type: "cid-pull",
			walletAddress: WALLET,
			collectionId: collection.id,
			payload: {
				collectionId: collection.id,
				manifestCid: "bafymanifest",
				collectionName: "pull-cancel",
			},
		});
		await tick();

		expect(await queue.cancel(job.id, WALLET)).toBe(true);
		await tick();

		const done = await queue.get(job.id, WALLET);
		expect(done?.status).toBe("cancelled");
		expect(controls.putHeadCalls).toHaveLength(0);
		const after = await repo.getCollection(collection.id);
		expect(after?.status).toBe("import_failed");
		await queue.stop();
	});

	it("cancel during manifest resolve aborts cleanly before any download", async () => {
		const manifest = buildManifest();
		const controls = buildFakeDeps(manifest);
		// Override resolve to hang until abort.
		controls.deps.resolveCollectionByCid = async (_cid, sig) => {
			await new Promise<void>((_resolve, reject) => {
				sig?.addEventListener("abort", () => reject(new Error("aborted")));
			});
			return { manifest, storage: { download: async () => new Uint8Array(), upload: async () => { throw new Error(); } } };
		};
		const queue = await setupQueue(repo, controls);
		const collection = await seedImportingCollection(repo, "pull-cancel-resolve");

		const job = await queue.enqueue({
			type: "cid-pull",
			walletAddress: WALLET,
			collectionId: collection.id,
			payload: {
				collectionId: collection.id,
				manifestCid: "bafymanifest",
				collectionName: "pull-cancel-resolve",
			},
		});
		await tick();
		expect(await queue.cancel(job.id, WALLET)).toBe(true);
		await tick();

		const done = await queue.get(job.id, WALLET);
		expect(done?.status).toBe("cancelled");
		expect(controls.downloadedSegments).toHaveLength(0);
		expect(controls.putHeadCalls).toHaveLength(0);
		await queue.stop();
	});

	it("malformed manifest (resolve throws) marks collection import_failed", async () => {
		const manifest = buildManifest();
		const controls = buildFakeDeps(manifest);
		controls.deps.resolveCollectionByCid = async () => {
			throw Object.assign(new Error("CID does not point to a wtfoc collection"), {
				code: "CID_NOT_MANIFEST",
			});
		};
		const queue = await setupQueue(repo, controls);
		const collection = await seedImportingCollection(repo, "pull-bad-manifest");

		const job = await queue.enqueue({
			type: "cid-pull",
			walletAddress: WALLET,
			collectionId: collection.id,
			payload: {
				collectionId: collection.id,
				manifestCid: "bafybroken",
				collectionName: "pull-bad-manifest",
			},
		});
		await tick();

		const done = await queue.get(job.id, WALLET);
		expect(done?.status).toBe("failed");
		const after = await repo.getCollection(collection.id);
		expect(after?.status).toBe("import_failed");
		await queue.stop();
	});

	it("emits monotonically increasing progress during download", async () => {
		const manifest = buildManifest();
		const controls = buildFakeDeps(manifest);
		const queue = await setupQueue(repo, controls);
		const collection = await seedImportingCollection(repo, "pull-progress");

		// Snapshot progress at each microtask boundary.
		const snapshots: number[] = [];
		const job = await queue.enqueue({
			type: "cid-pull",
			walletAddress: WALLET,
			collectionId: collection.id,
			payload: {
				collectionId: collection.id,
				manifestCid: "bafymanifest",
				collectionName: "pull-progress",
			},
		});

		for (let i = 0; i < 10; i++) {
			const snap = await queue.get(job.id, WALLET);
			if (snap) snapshots.push(snap.current);
			if (snap?.status === "succeeded") break;
			await tick(1);
		}
		for (let i = 1; i < snapshots.length; i++) {
			expect(snapshots[i]).toBeGreaterThanOrEqual(snapshots[i - 1]!);
		}
		await queue.stop();
	});

	it("enforces the 'one active mutating job per collection' invariant", async () => {
		const manifest = buildManifest();
		const controls = buildFakeDeps(manifest);
		controls.hangOnSegmentIndex = 0; // keep first job running
		const queue = await setupQueue(repo, controls);
		const collection = await seedImportingCollection(repo, "pull-busy");

		const first = await queue.enqueue({
			type: "cid-pull",
			walletAddress: WALLET,
			collectionId: collection.id,
			payload: {
				collectionId: collection.id,
				manifestCid: "bafymanifest",
				collectionName: "pull-busy",
			},
		});
		await tick();

		await expect(
			queue.enqueue({
				type: "cid-pull",
				walletAddress: WALLET,
				collectionId: collection.id,
				payload: {
					collectionId: collection.id,
					manifestCid: "bafyother",
					collectionName: "pull-busy",
				},
			}),
		).rejects.toBeInstanceOf(JobCollectionBusyError);

		await queue.cancel(first.id, WALLET);
		await tick();
		await queue.stop();
	});

	it("wallet scoping: another wallet cannot read or cancel the job", async () => {
		const manifest = buildManifest();
		const controls = buildFakeDeps(manifest);
		controls.hangOnSegmentIndex = 0;
		const queue = await setupQueue(repo, controls);
		const collection = await seedImportingCollection(repo, "pull-scope");

		const job = await queue.enqueue({
			type: "cid-pull",
			walletAddress: WALLET,
			collectionId: collection.id,
			payload: {
				collectionId: collection.id,
				manifestCid: "bafymanifest",
				collectionName: "pull-scope",
			},
		});
		await tick();

		expect(await queue.get(job.id, OTHER_WALLET)).toBeNull();
		expect(await queue.cancel(job.id, OTHER_WALLET)).toBe(false);

		await queue.cancel(job.id, WALLET);
		await tick();
		await queue.stop();
	});
});

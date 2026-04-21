/**
 * Materialize handler tests (#288 Phase 2 Slice C).
 *
 * Pins the idempotency contract: retries are safe, duplicate segments
 * become no-ops, CAS conflicts resolve. Uses injected MaterializeDeps so
 * no real `@wtfoc/store` or filesystem is involved.
 */
import type { CollectionHead } from "@wtfoc/common";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../db/memory.js";
import { InMemoryJobQueue } from "../jobs/in-memory.js";
import type { MaterializePayload } from "../jobs/types.js";
import {
	type MaterializeDeps,
	registerMaterializeHandler,
} from "./materialize-worker.js";

const WALLET = "0xWallet1";

async function tick(ms = 5): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

function basePayload(overrides: Partial<MaterializePayload> = {}): MaterializePayload {
	return {
		collectionId: "coll-1",
		collectionName: "demo-collection",
		segmentId: "seg-1",
		chunkCount: 10,
		sourceCount: 1,
		sourceTypes: ["github"],
		embeddingModel: "nomic-embed-text",
		embeddingDimensions: 384,
		...overrides,
	};
}

interface FakeHeadControls {
	putHeadCalls: Array<{ name: string; manifest: CollectionHead; prev: string | null }>;
	putHeadErrorOnceOnAttempt: number | null;
	deps: MaterializeDeps;
}

function buildFakeDeps(initial: CollectionHead | null = null): FakeHeadControls {
	let current: { manifest: CollectionHead; headId: string } | null = initial
		? { manifest: initial, headId: "head-0" }
		: null;
	const putHeadCalls: FakeHeadControls["putHeadCalls"] = [];
	const controls: FakeHeadControls = {
		putHeadCalls,
		putHeadErrorOnceOnAttempt: null,
		deps: undefined as unknown as MaterializeDeps,
	};
	controls.deps = {
		getHead: async () => (current ? { manifest: current.manifest, headId: current.headId } : null),
		putHead: async (name, manifest, prev) => {
			putHeadCalls.push({ name, manifest, prev });
			if (
				controls.putHeadErrorOnceOnAttempt !== null &&
				putHeadCalls.length === controls.putHeadErrorOnceOnAttempt
			) {
				// Simulate a concurrent writer: bump headId only (no segment change)
				// so the next getHead sees a stale prev but the same segment list —
				// caller should successfully CAS-append on the retry.
				if (current) {
					current = { ...current, headId: `head-conflict-${putHeadCalls.length}` };
				}
				throw new Error("CAS conflict (simulated)");
			}
			current = { manifest, headId: `head-${putHeadCalls.length}` };
		},
		generateCollectionId: (n) => `id-${n}`,
	};
	return controls;
}

async function setupQueue(repo: InMemoryRepository, deps: MaterializeDeps) {
	const q = new InMemoryJobQueue();
	registerMaterializeHandler(q, repo, async () => deps);
	await q.start();
	return q;
}

async function seedCollection(repo: InMemoryRepository, name: string) {
	const created = await repo.createCollection({
		name,
		walletAddress: WALLET,
		sources: [],
	});
	await repo.updateCollectionStatus(created.id, "ingesting");
	return created;
}

describe("materialize-worker", () => {
	let repo: InMemoryRepository;
	beforeEach(() => {
		repo = new InMemoryRepository();
	});

	it("first materialization creates the head and marks collection ready", async () => {
		const controls = buildFakeDeps(null);
		const q = await setupQueue(repo, controls.deps);
		const col = await seedCollection(repo, "mat-happy");
		const payload = basePayload({ collectionId: col.id, collectionName: "mat-happy" });

		await q.enqueue({
			type: "materialize",
			walletAddress: WALLET,
			collectionId: col.id,
			payload,
		});
		await tick();

		expect(controls.putHeadCalls).toHaveLength(1);
		const written = controls.putHeadCalls[0]?.manifest;
		expect(written?.segments.map((s) => s.id)).toEqual(["seg-1"]);
		expect(written?.totalChunks).toBe(10);
		const after = await repo.getCollection(col.id);
		expect(after?.status).toBe("ready");
		expect(after?.segmentCount).toBe(1);
		await q.stop();
	});

	it("re-running with the same segmentId is a no-op — no second putHead", async () => {
		const existingManifest: CollectionHead = {
			schemaVersion: 1,
			collectionId: "coll-xyz",
			name: "mat-dedupe",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-1", sourceTypes: ["github"], chunkCount: 10 }],
			totalChunks: 10,
			embeddingModel: "nomic-embed-text",
			embeddingDimensions: 384,
			createdAt: "2026-04-20T00:00:00Z",
			updatedAt: "2026-04-20T00:00:00Z",
		};
		const controls = buildFakeDeps(existingManifest);
		const q = await setupQueue(repo, controls.deps);
		const col = await seedCollection(repo, "mat-dedupe");
		const payload = basePayload({ collectionId: col.id, collectionName: "mat-dedupe" });

		await q.enqueue({
			type: "materialize",
			walletAddress: WALLET,
			collectionId: col.id,
			payload,
		});
		await tick();

		expect(controls.putHeadCalls).toHaveLength(0);
		const after = await repo.getCollection(col.id);
		expect(after?.status).toBe("ready");
		expect(after?.segmentCount).toBe(1);
		await q.stop();
	});

	it("retries on CAS conflict and eventually succeeds", async () => {
		const controls = buildFakeDeps(null);
		controls.putHeadErrorOnceOnAttempt = 1; // first putHead throws, second succeeds
		const q = await setupQueue(repo, controls.deps);
		const col = await seedCollection(repo, "mat-cas");
		const payload = basePayload({ collectionId: col.id, collectionName: "mat-cas" });

		const job = await q.enqueue({
			type: "materialize",
			walletAddress: WALLET,
			collectionId: col.id,
			payload,
		});
		await tick();

		expect(controls.putHeadCalls.length).toBeGreaterThanOrEqual(2);
		const done = await q.get(job.id, WALLET);
		expect(done?.status).toBe("succeeded");
		const after = await repo.getCollection(col.id);
		expect(after?.status).toBe("ready");
		await q.stop();
	});

	it("after CAS conflict finds the segment already present and exits cleanly", async () => {
		// Simulate: our CAS attempt fails, then the reloaded head already
		// contains the segment (another materializer landed the same artifact).
		// The handler should treat that as success without a second putHead.
		const existing: CollectionHead = {
			schemaVersion: 1,
			collectionId: "coll-race",
			name: "mat-race",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-1", sourceTypes: ["github"], chunkCount: 10 }],
			totalChunks: 10,
			embeddingModel: "nomic-embed-text",
			embeddingDimensions: 384,
			createdAt: "2026-04-20T00:00:00Z",
			updatedAt: "2026-04-20T00:00:00Z",
		};
		let callCount = 0;
		const deps: MaterializeDeps = {
			getHead: async () => {
				callCount++;
				// First call: no head. Second call (after CAS conflict): segment already present.
				if (callCount === 1) return null;
				return { manifest: existing, headId: "head-raced" };
			},
			putHead: async () => {
				throw new Error("CAS conflict");
			},
			generateCollectionId: (n) => `id-${n}`,
		};
		const q = await setupQueue(repo, deps);
		const col = await seedCollection(repo, "mat-race");
		const payload = basePayload({ collectionId: col.id, collectionName: "mat-race" });

		const job = await q.enqueue({
			type: "materialize",
			walletAddress: WALLET,
			collectionId: col.id,
			payload,
		});
		await tick();

		const done = await q.get(job.id, WALLET);
		expect(done?.status).toBe("succeeded");
		const after = await repo.getCollection(col.id);
		expect(after?.status).toBe("ready");
		await q.stop();
	});

	it("gives up after CAS_RETRIES and marks collection failed", async () => {
		const deps: MaterializeDeps = {
			getHead: async () => null,
			putHead: async () => {
				throw new Error("persistent CAS conflict");
			},
			generateCollectionId: (n) => `id-${n}`,
		};
		const q = await setupQueue(repo, deps);
		const col = await seedCollection(repo, "mat-give-up");
		const payload = basePayload({ collectionId: col.id, collectionName: "mat-give-up" });

		const job = await q.enqueue({
			type: "materialize",
			walletAddress: WALLET,
			collectionId: col.id,
			payload,
		});
		await tick();

		const done = await q.get(job.id, WALLET);
		expect(done?.status).toBe("failed");
		const after = await repo.getCollection(col.id);
		expect(after?.status).toBe("ingestion_failed");
		await q.stop();
	});

	it("appends to an existing manifest and updates totalChunks", async () => {
		const existing: CollectionHead = {
			schemaVersion: 1,
			collectionId: "coll-append",
			name: "mat-append",
			currentRevisionId: null,
			prevHeadId: null,
			segments: [{ id: "seg-0", sourceTypes: ["github"], chunkCount: 5 }],
			totalChunks: 5,
			embeddingModel: "nomic-embed-text",
			embeddingDimensions: 384,
			createdAt: "2026-04-20T00:00:00Z",
			updatedAt: "2026-04-20T00:00:00Z",
		};
		const controls = buildFakeDeps(existing);
		const q = await setupQueue(repo, controls.deps);
		const col = await seedCollection(repo, "mat-append");
		const payload = basePayload({ collectionId: col.id, collectionName: "mat-append" });

		await q.enqueue({
			type: "materialize",
			walletAddress: WALLET,
			collectionId: col.id,
			payload,
		});
		await tick();

		const written = controls.putHeadCalls[0]?.manifest;
		expect(written?.segments.map((s) => s.id)).toEqual(["seg-0", "seg-1"]);
		expect(written?.totalChunks).toBe(15);
		expect(written?.collectionId).toBe("coll-append"); // reused, not regenerated
		await q.stop();
	});
});

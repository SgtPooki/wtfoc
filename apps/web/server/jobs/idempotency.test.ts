/**
 * Idempotency + enqueueChild contract (#288 Phase 2 Slice C).
 * These invariants underpin the upcoming ingest → materialize chain —
 * parent retries must not fan out duplicate children, and the
 * active-root-per-collection index must tolerate parent ↔ child overlap.
 */
import { describe, expect, it } from "vitest";
import { InMemoryJobQueue, JobCollectionBusyError } from "./in-memory.js";
import type { IngestPayload, JobRecord } from "./types.js";

const WALLET = "0xWallet1";

async function tick(ms = 5): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("JobQueue idempotency + enqueueChild", () => {
	it("dedupes enqueue by idempotencyKey — repeat calls return the same record", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {});
		await q.start();
		const first = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c1",
			payload: { collectionId: "x" },
			idempotencyKey: "k-1",
		});
		const repeat = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c2-ignored",
			payload: { collectionId: "y-ignored" },
			idempotencyKey: "k-1",
		});
		expect(repeat.id).toBe(first.id);
		expect(repeat.idempotencyKey).toBe("k-1");
		await q.stop();
	});

	it("child jobs targeting the parent's collectionId do not collide with the parent", async () => {
		const q = new InMemoryJobQueue();
		let child: JobRecord | undefined;
		q.register<IngestPayload>("ingest", async (_p, ctx) => {
			child = await ctx.enqueueChild(
				"cid-pull",
				{
					collectionId: "c-same",
					manifestCid: "bafy...",
					collectionName: "n",
				},
				{ idempotencyKey: `p:${ctx.jobId}:child` },
			);
		});
		q.register("cid-pull", async () => {});
		await q.start();
		const parent = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c-same",
			payload: { collectionId: "x" },
		});
		await tick();
		expect(child).toBeDefined();
		expect(child?.parentJobId).toBe(parent.id);
		expect(child?.collectionId).toBe("c-same");
		await q.stop();
	});

	it("enqueueChild dedupes across repeat calls via idempotencyKey", async () => {
		const q = new InMemoryJobQueue();
		const children: JobRecord[] = [];
		q.register<IngestPayload>("ingest", async (_p, ctx) => {
			children.push(
				await ctx.enqueueChild(
					"cid-pull",
					{
						collectionId: "c-retry",
						manifestCid: "bafy...",
						collectionName: "n",
					},
					{ idempotencyKey: "collection:foo:materialize:seg-1" },
				),
			);
			children.push(
				await ctx.enqueueChild(
					"cid-pull",
					{
						collectionId: "c-retry",
						manifestCid: "bafy-other...",
						collectionName: "n2",
					},
					{ idempotencyKey: "collection:foo:materialize:seg-1" },
				),
			);
		});
		q.register("cid-pull", async () => {});
		await q.start();
		await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c-retry",
			payload: { collectionId: "x" },
		});
		await tick();
		expect(children).toHaveLength(2);
		expect(children[0]?.id).toBe(children[1]?.id);
		await q.stop();
	});

	it("two concurrent root enqueues for the same collectionId still fail with COLLECTION_BUSY", async () => {
		// The invariant applies to roots only, but it must still block two
		// concurrent ingests on the same collection.
		const q = new InMemoryJobQueue();
		let release: (() => void) | undefined;
		q.register<IngestPayload>("ingest", async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		});
		await q.start();
		await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c-root",
			payload: { collectionId: "x" },
		});
		await tick();
		await expect(
			q.enqueue({
				type: "ingest",
				walletAddress: WALLET,
				collectionId: "c-root",
				payload: { collectionId: "y" },
			}),
		).rejects.toBeInstanceOf(JobCollectionBusyError);
		release?.();
		await q.stop();
	});
});

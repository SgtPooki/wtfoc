/**
 * InMemoryJobQueue subscription behavior (#288 Phase 2 Slice B).
 * Pins the full-snapshot emit contract the SSE route relies on.
 */
import { describe, expect, it } from "vitest";
import { InMemoryJobQueue } from "./in-memory.js";
import type { IngestPayload, JobRecord } from "./types.js";

const WALLET = "0xWallet1";

async function tick(ms = 5): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("InMemoryJobQueue.subscribe", () => {
	it("emits full snapshots for running, progress, and terminal transitions", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async (_p, ctx) => {
			await ctx.reportProgress({ phase: "p1", current: 1, total: 3 });
			await ctx.reportProgress({ current: 3 });
		});
		await q.start();
		const job = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-sub-1",
			payload: { collectionId: "x" },
		});
		const snapshots: JobRecord[] = [];
		const unsub = await q.subscribe(job.id, WALLET, (snap) => {
			snapshots.push(snap);
		});
		await tick();
		unsub();

		const statuses = snapshots.map((s) => s.status);
		expect(statuses).toContain("running");
		expect(statuses).toContain("succeeded");
		// Current counter must climb monotonically as progress is reported.
		const currents = snapshots.map((s) => s.current);
		for (let i = 1; i < currents.length; i++) {
			expect(currents[i]!).toBeGreaterThanOrEqual(currents[i - 1]!);
		}
		await q.stop();
	});

	it("unsubscribed listeners receive no further events", async () => {
		const q = new InMemoryJobQueue();
		let release: (() => void) | undefined;
		q.register<IngestPayload>("ingest", async (_p, ctx) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			await ctx.reportProgress({ current: 1, total: 1 });
		});
		await q.start();
		const job = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-sub-2",
			payload: { collectionId: "x" },
		});
		let received = 0;
		const unsub = await q.subscribe(job.id, WALLET, () => {
			received++;
		});
		unsub();
		// Now let the handler finish: unsubscribed listener must not see anything.
		release?.();
		await tick();
		expect(received).toBe(0);
		await q.stop();
	});

	it("cross-wallet subscribe returns a no-op unsubscribe with no deliveries", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {});
		await q.start();
		const job = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-sub-3",
			payload: { collectionId: "x" },
		});
		let leaked = 0;
		const unsub = await q.subscribe(job.id, "0xOther", () => {
			leaked++;
		});
		await tick();
		unsub();
		expect(leaked).toBe(0);
		await q.stop();
	});

	it("subscribing after terminal still receives a snapshot on demand via get()", async () => {
		// Subscribers only deliver for future transitions — callers grab the
		// current state via get() and then subscribe. This test pins that
		// expectation so the SSE route can assume "send initial + subscribe".
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {});
		await q.start();
		const job = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-sub-4",
			payload: { collectionId: "x" },
		});
		await tick();
		const current = await q.get(job.id, WALLET);
		expect(current?.status).toBe("succeeded");
		let post = 0;
		const unsub = await q.subscribe(job.id, WALLET, () => {
			post++;
		});
		await tick();
		unsub();
		expect(post).toBe(0);
		await q.stop();
	});
});

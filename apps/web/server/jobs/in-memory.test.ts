import { describe, expect, it } from "vitest";
import { InMemoryJobQueue, JobCollectionBusyError } from "./in-memory.js";
import type { IngestPayload } from "./types.js";

async function tick(ms = 5): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

const WALLET = "0xWallet1";

describe("InMemoryJobQueue", () => {
	it("rejects payloads that fail the registered valibot schema", async () => {
		const q = new InMemoryJobQueue();
		await q.start();
		await expect(
			q.enqueue({
				type: "ingest",
				walletAddress: WALLET,
				collectionId: "coll-1",
				payload: { wrong: "shape" },
			}),
		).rejects.toThrow();
		await q.stop();
	});

	it("runs the handler and transitions queued → running → succeeded", async () => {
		const q = new InMemoryJobQueue();
		let seenPayload: IngestPayload | undefined;
		q.register<IngestPayload>("ingest", async (payload, ctx) => {
			seenPayload = payload;
			await ctx.reportProgress({ phase: "embedding", current: 1, total: 3 });
			await ctx.reportProgress({ current: 3, total: 3 });
		});
		await q.start();
		const job = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-1",
			payload: { collectionName: "foo" },
		});
		expect(job.status).toBe("queued");

		// Let the microtask run
		await tick();
		const done = await q.get(job.id, WALLET);
		expect(done?.status).toBe("succeeded");
		expect(done?.phase).toBe("embedding");
		expect(done?.current).toBe(3);
		expect(done?.total).toBe(3);
		expect(seenPayload).toEqual({ collectionName: "foo" });
		await q.stop();
	});

	it("records failures from the handler on the job row", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {
			throw new Error("boom");
		});
		await q.start();
		const job = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-2",
			payload: { collectionName: "bar" },
		});
		await tick();
		const done = await q.get(job.id, WALLET);
		expect(done?.status).toBe("failed");
		expect(done?.errorMessage).toBe("boom");
		await q.stop();
	});

	it("enforces 'one active mutating job per collection'", async () => {
		const q = new InMemoryJobQueue();
		// Handler that holds the signal so the first job stays running while
		// the second enqueue is attempted.
		let release: (() => void) | undefined;
		q.register<IngestPayload>("ingest", async (_p, _ctx) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		});
		await q.start();
		const first = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-3",
			payload: { collectionName: "a" },
		});
		await tick();
		await expect(
			q.enqueue({
				type: "ingest",
				walletAddress: WALLET,
				collectionId: "coll-3",
				payload: { collectionName: "a-again" },
			}),
		).rejects.toBeInstanceOf(JobCollectionBusyError);
		release?.();
		await tick();
		const done = await q.get(first.id, WALLET);
		expect(done?.status).toBe("succeeded");
		// After the first finishes, enqueue for the same collection is allowed.
		await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-3",
			payload: { collectionName: "a-redo" },
		});
		release?.();
		await q.stop();
	});

	it("cancels a queued job immediately (before dispatch)", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {
			// never called
		});
		// Note: don't call start() — job stays queued, not dispatched.
		const job = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-4",
			payload: { collectionName: "x" },
		});
		const ok = await q.cancel(job.id, WALLET);
		expect(ok).toBe(true);
		const got = await q.get(job.id, WALLET);
		expect(got?.status).toBe("cancelled");
		expect(got?.cancelRequestedAt).not.toBeNull();
	});

	it("cancels a running job cooperatively via AbortController", async () => {
		const q = new InMemoryJobQueue();
		let sawAbort = false;
		q.register<IngestPayload>("ingest", async (_p, ctx) => {
			await new Promise<void>((resolve, reject) => {
				ctx.signal.addEventListener("abort", () => {
					sawAbort = true;
					reject(new Error("aborted"));
				});
			});
		});
		await q.start();
		const job = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-5",
			payload: { collectionName: "x" },
		});
		await tick();
		await q.cancel(job.id, WALLET);
		await tick();
		const done = await q.get(job.id, WALLET);
		expect(done?.status).toBe("cancelled");
		expect(sawAbort).toBe(true);
		await q.stop();
	});

	it("scopes reads by wallet — another wallet sees null", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {});
		await q.start();
		const job = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-6",
			payload: { collectionName: "x" },
		});
		await tick();
		expect(await q.get(job.id, "0xOther")).toBeNull();
		const list = await q.list("0xOther");
		expect(list).toEqual([]);
		await q.stop();
	});

	it("list returns summaries without message/errorMessage", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async (_p, ctx) => {
			await ctx.reportProgress({ message: "hello" });
		});
		await q.start();
		await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-7",
			payload: { collectionName: "x" },
		});
		await tick();
		const list = await q.list(WALLET);
		expect(list).toHaveLength(1);
		// Summary should not expose message/errorMessage even though the handler set them.
		expect((list[0] as unknown as Record<string, unknown>).message).toBeUndefined();
		expect((list[0] as unknown as Record<string, unknown>).errorMessage).toBeUndefined();
		await q.stop();
	});

	it("list filters by collection and status", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {});
		await q.start();
		const a = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-A",
			payload: { collectionName: "a" },
		});
		const b = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "coll-B",
			payload: { collectionName: "b" },
		});
		await tick();
		const filtered = await q.list(WALLET, { collectionId: "coll-A" });
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.id).toBe(a.id);
		const statusFiltered = await q.list(WALLET, { status: "succeeded" });
		expect(statusFiltered.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
		await q.stop();
	});
});

/**
 * Parent/child job plumbing (#288 Phase 2 Slice C1).
 *
 * Pins the contract the future pipeline chain depends on:
 *  - enqueue with a bogus parentJobId is rejected
 *  - listChildren is wallet-scoped and createdAt-ascending
 *  - listChildren returns [] for non-visible parents
 */
import { describe, expect, it } from "vitest";
import { InMemoryJobQueue } from "./in-memory.js";
import type { IngestPayload } from "./types.js";

const WALLET = "0xWallet1";
const OTHER = "0xWallet2";

async function tick(ms = 5): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("JobQueue parent/child plumbing", () => {
	it("rejects enqueue with unknown parentJobId", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {});
		await q.start();
		await expect(
			q.enqueue({
				type: "ingest",
				walletAddress: WALLET,
				collectionId: "c1",
				payload: { collectionId: "x" },
				parentJobId: "00000000-0000-0000-0000-000000000000",
			}),
		).rejects.toThrow(/parent job not found/);
		await q.stop();
	});

	it("rejects enqueue when parentJobId belongs to another wallet", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {});
		await q.start();
		const parent = await q.enqueue({
			type: "ingest",
			walletAddress: OTHER,
			collectionId: "c-other",
			payload: { collectionId: "x" },
		});
		await expect(
			q.enqueue({
				type: "ingest",
				walletAddress: WALLET,
				collectionId: "c-mine",
				payload: { collectionId: "y" },
				parentJobId: parent.id,
			}),
		).rejects.toThrow(/parent job not found/);
		await q.stop();
	});

	it("listChildren returns [] for non-visible parents", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {});
		await q.start();
		const parent = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c-p",
			payload: { collectionId: "x" },
		});
		expect(await q.listChildren(parent.id, OTHER)).toEqual([]);
		expect(await q.listChildren("not-a-real-id", WALLET)).toEqual([]);
		await q.stop();
	});

	it("listChildren returns children in createdAt-ascending order", async () => {
		const q = new InMemoryJobQueue();
		let resolveFirst: (() => void) | undefined;
		q.register<IngestPayload>("ingest", async () => {
			if (resolveFirst) {
				await new Promise<void>((resolve) => {
					resolveFirst = resolve;
				});
			}
		});
		await q.start();
		// Use a sentinel so the parent stays running while we enqueue children.
		resolveFirst = () => {};
		const parent = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c-parent",
			payload: { collectionId: "x" },
		});
		await tick();

		const childA = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c-a",
			payload: { collectionId: "a" },
			parentJobId: parent.id,
		});
		await tick(2);
		const childB = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c-b",
			payload: { collectionId: "b" },
			parentJobId: parent.id,
		});

		const list = await q.listChildren(parent.id, WALLET);
		expect(list.map((c) => c.id)).toEqual([childA.id, childB.id]);
		await q.stop();
	});

	it("does not leak children across wallets", async () => {
		const q = new InMemoryJobQueue();
		q.register<IngestPayload>("ingest", async () => {});
		await q.start();
		const parent = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c-parent-scope",
			payload: { collectionId: "x" },
		});
		const child = await q.enqueue({
			type: "ingest",
			walletAddress: WALLET,
			collectionId: "c-child-scope",
			payload: { collectionId: "y" },
			parentJobId: parent.id,
		});
		const crossView = await q.listChildren(parent.id, OTHER);
		expect(crossView).toEqual([]);
		const own = await q.listChildren(parent.id, WALLET);
		expect(own.map((c) => c.id)).toEqual([child.id]);
		await q.stop();
	});
});

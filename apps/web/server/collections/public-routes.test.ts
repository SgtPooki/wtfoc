/**
 * Route-level tests for the unauthenticated public CID pull endpoint
 * (bead wtfoc-1xxh). Uses InMemoryRepository + InMemoryJobQueue so we
 * exercise the full wiring — hono app, csrf/cors middleware, validators,
 * job enqueue — without a real postgres or IPFS.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../db/memory.js";
import { createHonoApp } from "../hono-app.js";
import { InMemoryJobQueue } from "../jobs/in-memory.js";
import { PUBLIC_WALLET_ADDRESS } from "./public-routes.js";

const VALID_CID = "bafkreif5ezwktkpifmyvwh77cocskinjn7g5tho64t2clb2uzezmrhgzci";

function buildApp() {
	const repo = new InMemoryRepository();
	const queue = new InMemoryJobQueue();
	const app = createHonoApp(repo, () => queue);
	return { app, repo, queue };
}

async function postPull(
	app: ReturnType<typeof createHonoApp>,
	body: Record<string, unknown>,
): Promise<Response> {
	return app.request("/api/collections-public/pull", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("POST /api/collections-public/pull", () => {
	let harness: ReturnType<typeof buildApp>;

	beforeEach(() => {
		harness = buildApp();
	});

	it("enqueues a cid-pull job under the public sentinel wallet", async () => {
		const res = await postPull(harness.app, { manifestCid: VALID_CID, name: "flagship-v12" });

		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			collectionId: string;
			jobId: string;
			name: string;
			status: string;
			manifestCid: string;
		};
		expect(body.name).toBe("flagship-v12");
		expect(body.status).toBe("importing");
		expect(body.manifestCid).toBe(VALID_CID);
		expect(body.collectionId).toBeTruthy();
		expect(body.jobId).toBeTruthy();

		const collection = await harness.repo.getCollection(body.collectionId);
		expect(collection?.walletAddress).toBe(PUBLIC_WALLET_ADDRESS);
		expect(collection?.status).toBe("importing");
	});

	it("requires manifestCid", async () => {
		const res = await postPull(harness.app, { name: "x" });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("INVALID_CID");
	});

	it("requires name", async () => {
		const res = await postPull(harness.app, { manifestCid: VALID_CID });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("INVALID_NAME");
	});

	it("rejects absurdly long CIDs", async () => {
		const res = await postPull(harness.app, {
			manifestCid: "a".repeat(500),
			name: "x",
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("INVALID_CID");
	});

	it("returns 409 on duplicate collection name", async () => {
		const first = await postPull(harness.app, { manifestCid: VALID_CID, name: "dup" });
		expect(first.status).toBe(201);
		const second = await postPull(harness.app, { manifestCid: VALID_CID, name: "dup" });
		expect(second.status).toBe(409);
		const body = (await second.json()) as { code: string };
		expect(body.code).toBe("DUPLICATE_NAME");
	});

	it("does not require a wallet cookie / signature", async () => {
		// No Cookie / Authorization header — succeeds anyway.
		const res = await postPull(harness.app, { manifestCid: VALID_CID, name: "no-auth" });
		expect(res.status).toBe(201);
	});
});

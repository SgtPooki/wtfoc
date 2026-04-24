/**
 * Route-level tests for the unauthenticated public CID pull endpoint.
 * Uses InMemoryRepository + InMemoryJobQueue so we exercise the full
 * wiring — hono app, csrf/cors middleware, validators, job enqueue —
 * without a real postgres or IPFS.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "../db/memory.js";
import { createHonoApp } from "../hono-app.js";
import { InMemoryJobQueue } from "../jobs/in-memory.js";
import { PUBLIC_WALLET_ADDRESS, resolvePublicPullMode } from "./public-routes.js";

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

describe("resolvePublicPullMode", () => {
	it("defaults to off when env var unset", () => {
		expect(resolvePublicPullMode(undefined).kind).toBe("off");
	});
	it("treats empty string as off", () => {
		expect(resolvePublicPullMode("").kind).toBe("off");
	});
	it("treats 'off' as off", () => {
		expect(resolvePublicPullMode("off").kind).toBe("off");
	});
	it("treats 'on' as on", () => {
		expect(resolvePublicPullMode("on").kind).toBe("on");
	});
	it("parses token:<secret>", () => {
		const mode = resolvePublicPullMode("token:s3cret");
		expect(mode.kind).toBe("token");
		if (mode.kind === "token") expect(mode.secret).toBe("s3cret");
	});
	it("treats empty token: as off (fail safe)", () => {
		expect(resolvePublicPullMode("token:").kind).toBe("off");
	});
	it("fails safe to off on unknown values", () => {
		expect(resolvePublicPullMode("yolo").kind).toBe("off");
	});
});

describe("POST /api/collections-public/pull", () => {
	let harness: ReturnType<typeof buildApp>;
	let origEnv: string | undefined;

	beforeEach(() => {
		harness = buildApp();
		origEnv = process.env.WTFOC_PUBLIC_CID_PULL;
		process.env.WTFOC_PUBLIC_CID_PULL = "on";
	});

	afterEach(() => {
		if (origEnv === undefined) delete process.env.WTFOC_PUBLIC_CID_PULL;
		else process.env.WTFOC_PUBLIC_CID_PULL = origEnv;
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

	it("does not require a wallet cookie / signature when mode=on", async () => {
		// No Cookie / Authorization header — succeeds anyway.
		const res = await postPull(harness.app, { manifestCid: VALID_CID, name: "no-auth" });
		expect(res.status).toBe(201);
	});

	it("returns 503 when WTFOC_PUBLIC_CID_PULL is off (default)", async () => {
		process.env.WTFOC_PUBLIC_CID_PULL = "off";
		const res = await postPull(harness.app, { manifestCid: VALID_CID, name: "disabled" });
		expect(res.status).toBe(503);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("PUBLIC_PULL_DISABLED");
	});

	it("returns 401 when token mode and header missing", async () => {
		process.env.WTFOC_PUBLIC_CID_PULL = "token:hunter2";
		const res = await postPull(harness.app, { manifestCid: VALID_CID, name: "need-token" });
		expect(res.status).toBe(401);
		const body = (await res.json()) as { code: string };
		expect(body.code).toBe("INVALID_TOKEN");
	});

	it("returns 401 when token mode and header wrong", async () => {
		process.env.WTFOC_PUBLIC_CID_PULL = "token:hunter2";
		const res = await harness.app.request("/api/collections-public/pull", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-public-pull-token": "wrong",
			},
			body: JSON.stringify({ manifestCid: VALID_CID, name: "bad-token" }),
		});
		expect(res.status).toBe(401);
	});

	it("accepts token mode when header matches", async () => {
		process.env.WTFOC_PUBLIC_CID_PULL = "token:hunter2";
		const res = await harness.app.request("/api/collections-public/pull", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-public-pull-token": "hunter2",
			},
			body: JSON.stringify({ manifestCid: VALID_CID, name: "good-token" }),
		});
		expect(res.status).toBe(201);
	});
});

/**
 * Public (unauthenticated) collection routes.
 *
 * Pulling a published CID from FOC is a public, content-addressed operation.
 * Integrity is provable via `verify-collection` — no user identity required.
 * This router exposes a wallet-free CID pull path that enqueues a `cid-pull`
 * job under a sentinel zero-address wallet so the existing worker pipeline
 * + rate limiter can reuse wallet_address for accounting without the caller
 * having to sign anything. Bead wtfoc-1xxh.
 */

import { Hono } from "hono";
import type { Repository } from "../db/index.js";
import type { AppEnv } from "../hono-app.js";
import { JobCollectionBusyError } from "../jobs/in-memory.js";
import type { JobQueue } from "../jobs/queue.js";
import { ipRateLimiter } from "../security/rate-limit.js";
import { validateCollectionName } from "./validators.js";

/**
 * Sentinel wallet address for unauthenticated public pulls. Keeps the
 * `wallet_address` NOT NULL constraint + rate limiter happy without
 * impersonating a real user. Collections owned by this address are
 * treated as publicly readable by downstream listing code.
 */
export const PUBLIC_WALLET_ADDRESS = "0x0000000000000000000000000000000000000000";

const publicPullRateLimit = ipRateLimiter(20, 3600); // 20 pulls per hour per IP

export const publicCollectionRoutes = new Hono<AppEnv>();

/**
 * POST /api/collections-public/pull
 *
 * Body: { manifestCid: string, name: string }
 *
 * No wallet auth. Creates a public collection row owned by the zero-address
 * sentinel wallet, enqueues a `cid-pull` job, returns `{ collectionId, jobId,
 * name, status, manifestCid }`. The finished collection surfaces in
 * GET /api/collections (file-listing) once the job completes.
 */
publicCollectionRoutes.post("/pull", publicPullRateLimit.middleware(), async (c) => {
	const repo = c.get("repo") as Repository;
	const body = await c.req.json<{ manifestCid?: string; name?: string }>();

	const manifestCid = typeof body.manifestCid === "string" ? body.manifestCid.trim() : "";
	if (!manifestCid) {
		return c.json({ error: "manifestCid is required", code: "INVALID_CID" }, 400);
	}
	if (manifestCid.length > 256) {
		return c.json({ error: "manifestCid is too long", code: "INVALID_CID" }, 400);
	}

	const name = typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim() : "";
	if (!name) {
		return c.json({ error: "name is required", code: "INVALID_NAME" }, 400);
	}
	const nameError = validateCollectionName(name);
	if (nameError) {
		return c.json({ error: nameError, code: "INVALID_NAME" }, 400);
	}

	let created: Awaited<ReturnType<Repository["createCollection"]>>;
	try {
		created = await repo.createCollection({
			name,
			walletAddress: PUBLIC_WALLET_ADDRESS,
			sources: [],
		});
	} catch (err) {
		if (err instanceof Error && err.message.includes("already exists")) {
			return c.json({ error: err.message, code: "DUPLICATE_NAME" }, 409);
		}
		throw err;
	}
	await repo.updateCollectionStatus(created.id, "importing");

	const queue = c.get("jobQueue") as JobQueue | undefined;
	if (!queue) {
		return c.json({ error: "job queue not configured", code: "NO_QUEUE" }, 503);
	}

	let jobId: string;
	try {
		const job = await queue.enqueue({
			type: "cid-pull",
			walletAddress: PUBLIC_WALLET_ADDRESS,
			collectionId: created.id,
			payload: {
				collectionId: created.id,
				manifestCid,
				collectionName: name,
			},
		});
		jobId = job.id;
	} catch (err) {
		if (err instanceof JobCollectionBusyError) {
			return c.json({ error: err.message, code: "COLLECTION_BUSY" }, 409);
		}
		throw err;
	}

	return c.json(
		{
			collectionId: created.id,
			jobId,
			name: created.name,
			status: "importing" as const,
			manifestCid,
		},
		201,
	);
});

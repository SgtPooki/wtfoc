import { Hono } from "hono";
import type { AppEnv } from "../hono-app.js";
import type { Repository } from "../db/index.js";
import { requireAuth } from "../auth/middleware.js";
import { walletRateLimiter } from "../security/rate-limit.js";
import { validateCollectionName, validateSources } from "./validators.js";
import { startIngestion } from "./ingest-worker.js";
import { startPromotion } from "./promote-worker.js";

const createRateLimit = walletRateLimiter(10, 3600); // 10 collections per hour per wallet

const collections = new Hono<AppEnv>();

// All collection routes require authentication
collections.use("*", requireAuth);

/** POST /api/wallet-collections — Create a new collection and start ingestion */
collections.post("/", createRateLimit.middleware(), async (c) => {
	const repo = c.get("repo") as Repository;
	const walletAddress = c.get("walletAddress") as string;

	const body = await c.req.json<{
		name?: string;
		sources?: Array<{ type?: string; identifier?: string }>;
	}>();

	// Validate name
	const nameError = validateCollectionName(body.name ?? "");
	if (nameError) {
		return c.json({ error: nameError, code: "INVALID_NAME" }, 400);
	}

	// Validate sources
	const sourceResult = validateSources(body.sources ?? []);
	if (!sourceResult.valid) {
		return c.json({ error: sourceResult.errors.join("; "), code: "INVALID_SOURCES" }, 400);
	}

	// Create collection
	let result: Awaited<ReturnType<Repository["createCollection"]>>;
	try {
		result = await repo.createCollection({
			name: body.name as string,
			walletAddress,
			sources: sourceResult.sources,
		});
	} catch (err) {
		if (err instanceof Error && err.message.includes("already exists")) {
			return c.json({ error: err.message, code: "DUPLICATE_NAME" }, 409);
		}
		throw err;
	}

	// Start ingestion in background (non-blocking)
	startIngestion(result.id, result.sources, repo).catch((err) => {
		console.error(`[collections] Background ingestion failed for ${result.id}:`, err);
	});

	return c.json(
		{
			id: result.id,
			name: result.name,
			status: "ingesting",
			sources: result.sources.map((s) => ({
				id: s.id,
				type: s.sourceType,
				identifier: s.identifier,
				status: s.status,
			})),
			createdAt: result.createdAt.toISOString(),
		},
		201,
	);
});

/** GET /api/wallet-collections — List all collections owned by the authenticated wallet */
collections.get("/", async (c) => {
	const repo = c.get("repo") as Repository;
	const walletAddress = c.get("walletAddress") as string;

	const list = await repo.listCollectionsByWallet(walletAddress);

	return c.json({
		collections: list.map((col) => ({
			id: col.id,
			name: col.name,
			status: col.status,
			sourceCount: col.sourceCount,
			segmentCount: col.segmentCount,
			manifestCid: col.manifestCid,
			createdAt: col.createdAt.toISOString(),
			updatedAt: col.updatedAt.toISOString(),
		})),
	});
});

/** GET /api/wallet-collections/:id — Get collection detail with per-source status */
collections.get("/:id", async (c) => {
	const repo = c.get("repo") as Repository;
	const walletAddress = c.get("walletAddress") as string;
	const id = c.req.param("id");

	const col = await repo.getCollection(id);
	if (!col || col.walletAddress !== walletAddress) {
		return c.json({ error: "Collection not found", code: "NOT_FOUND" }, 404);
	}

	return c.json({
		id: col.id,
		name: col.name,
		status: col.status,
		manifestCid: col.manifestCid,
		pieceCid: col.pieceCid,
		sources: col.sources.map((s) => ({
			id: s.id,
			type: s.sourceType,
			identifier: s.identifier,
			status: s.status,
			chunkCount: s.chunkCount,
			error: s.errorMessage,
		})),
		createdAt: col.createdAt.toISOString(),
		updatedAt: col.updatedAt.toISOString(),
	});
});

/** POST /api/wallet-collections/:id/promote — Start FOC promotion */
collections.post("/:id/promote", async (c) => {
	const repo = c.get("repo") as Repository;
	const walletAddress = c.get("walletAddress") as string;
	const sessionId = c.get("sessionId") as string;
	const id = c.req.param("id");

	const col = await repo.getCollection(id);
	if (!col || col.walletAddress !== walletAddress) {
		return c.json({ error: "Collection not found", code: "NOT_FOUND" }, 404);
	}

	// Check status
	if (col.status === "promoting") {
		return c.json(
			{ id: col.id, status: col.status, promoteCheckpoint: col.promoteCheckpoint, code: "ALREADY_PROMOTING" },
			409,
		);
	}
	if (col.status !== "ready" && col.status !== "promotion_failed") {
		return c.json(
			{ error: `Collection must be in "ready" or "promotion_failed" state, got "${col.status}"`, code: "INVALID_STATUS" },
			400,
		);
	}

	// Check session key
	const session = await repo.getActiveSessionByWallet(walletAddress);
	if (!session?.sessionKeyEncrypted) {
		return c.json({ error: "Session key required for promotion. Delegate one first.", code: "SESSION_KEY_REQUIRED" }, 403);
	}
	if (session.sessionKeyExpiresAt && session.sessionKeyExpiresAt < new Date()) {
		return c.json({ error: "Session key expired. Delegate a new one.", code: "SESSION_KEY_EXPIRED" }, 403);
	}

	// Decrypt session key (in-memory mode stores plaintext)
	const sessionKeyDecrypted = new TextDecoder().decode(session.sessionKeyEncrypted);

	// Start promotion in background
	startPromotion(id, sessionKeyDecrypted, walletAddress, repo).catch((err) => {
		console.error(`[collections] Background promotion failed for ${id}:`, err);
	});

	return c.json({ id: col.id, status: "promoting", promoteCheckpoint: null }, 202);
});

/** GET /api/wallet-collections/:id/promote/status — Check promotion progress */
collections.get("/:id/promote/status", async (c) => {
	const repo = c.get("repo") as Repository;
	const walletAddress = c.get("walletAddress") as string;
	const id = c.req.param("id");

	const col = await repo.getCollection(id);
	if (!col || col.walletAddress !== walletAddress) {
		return c.json({ error: "Collection not found", code: "NOT_FOUND" }, 404);
	}

	return c.json({
		status: col.status,
		checkpoint: col.promoteCheckpoint,
		manifestCid: col.manifestCid,
		pieceCid: col.pieceCid,
		carRootCid: col.carRootCid,
	});
});

export { collections as collectionRoutes };

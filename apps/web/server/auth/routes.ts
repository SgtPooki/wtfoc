import { Hono } from "hono";
import type { AppEnv } from "../hono-app.js";
import type { Repository } from "../db/index.js";
import { ipRateLimiter } from "../security/rate-limit.js";
import { generateChallenge, verifySignature } from "./siwe.js";
import { generateCookieToken, getSessionCookie, setSessionCookie, clearSessionCookie } from "./session.js";
import { encryptSessionKey } from "./crypto.js";
import { requireAuth } from "./middleware.js";
import { abortPromotionsForWallet } from "../collections/promote-worker.js";

const challengeRateLimit = ipRateLimiter(20, 60);

const auth = new Hono<AppEnv>();

/** POST /api/auth/challenge — Request a SIWE nonce for wallet verification */
auth.post("/challenge", challengeRateLimit.middleware(), async (c) => {
	const body = await c.req.json<{ address?: string; chainId?: number }>();
	if (!body.address || !body.address.startsWith("0x")) {
		return c.json({ error: "Valid Ethereum address required", code: "INVALID_ADDRESS" }, 400);
	}

	const domain = new URL(c.req.url).hostname || "wtfoc.xyz";
	const chainId = body.chainId ?? 314159; // default to Calibration
	const challenge = generateChallenge(body.address, domain, chainId);

	return c.json({ nonce: challenge.nonce, message: challenge.message });
});

/** POST /api/auth/verify — Verify signed SIWE challenge, issue session cookie */
auth.post("/verify", challengeRateLimit.middleware(), async (c) => {
	const body = await c.req.json<{ message?: string; signature?: string; address?: string }>();
	if (!body.message || !body.signature || !body.address) {
		return c.json({ error: "message, signature, and address are required", code: "MISSING_FIELDS" }, 400);
	}

	await verifySignature(body.message, body.signature as `0x${string}`, body.address);

	const repo = c.get("repo") as Repository;
	const cookieToken = generateCookieToken();

	// Extract chain ID from SIWE message
	const chainIdMatch = body.message.match(/Chain ID: (\d+)/);
	const chainId = chainIdMatch?.[1] ? Number.parseInt(chainIdMatch[1], 10) : 314159;

	const session = await repo.createSession(body.address.toLowerCase(), cookieToken, chainId);
	setSessionCookie(c, cookieToken);

	return c.json({
		address: session.walletAddress,
		sessionKeyActive: session.sessionKeyEncrypted !== null,
		sessionKeyExpiresAt: session.sessionKeyExpiresAt?.toISOString() ?? null,
	});
});

/** GET /api/auth/session — Bootstrap: recover session state from cookie */
auth.get("/session", async (c) => {
	const token = getSessionCookie(c);
	if (!token) {
		return c.json({ authenticated: false });
	}

	const repo = c.get("repo") as Repository;
	const session = await repo.getSessionByToken(token);
	if (!session || session.revokedAt) {
		clearSessionCookie(c);
		return c.json({ authenticated: false });
	}

	return c.json({
		authenticated: true,
		address: session.walletAddress,
		chainId: session.chainId ?? 314159,
		sessionKeyActive: session.sessionKeyEncrypted !== null,
		sessionKeyExpiresAt: session.sessionKeyExpiresAt?.toISOString() ?? null,
	});
});

/** POST /api/auth/disconnect — Invalidate session cookie */
auth.post("/disconnect", requireAuth, async (c) => {
	const repo = c.get("repo") as Repository;
	const sessionId = c.get("sessionId") as string;

	await repo.revokeSession(sessionId);
	clearSessionCookie(c);

	return c.json({ disconnected: true });
});

/** POST /api/auth/session-key — Delegate or rotate a session key */
auth.post("/session-key", requireAuth, async (c) => {
	const repo = c.get("repo") as Repository;
	const sessionId = c.get("sessionId") as string;
	const walletAddress = c.get("walletAddress") as string;

	const body = await c.req.json<{
		sessionKey?: string;
		expiresAt?: string;
		chainId?: number;
	}>();

	if (!body.sessionKey || !body.sessionKey.startsWith("0x")) {
		return c.json({ error: "Valid session key (0x...) required", code: "INVALID_KEY" }, 400);
	}

	const expiresAt = body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

	// Encrypt session key before storing (AES-256-GCM when SESSION_KEY_ENCRYPTION_KEY is set)
	const keyBytes = encryptSessionKey(body.sessionKey);
	await repo.updateSessionKey(sessionId, keyBytes, walletAddress, expiresAt);

	await repo.logAudit(walletAddress, "delegated", undefined, {
		expiresAt: expiresAt.toISOString(),
		chainId: body.chainId ?? 314159,
	});

	return c.json({
		sessionKeyActive: true,
		sessionKeyExpiresAt: expiresAt.toISOString(),
	});
});

/** DELETE /api/auth/session-key — Revoke the current session key */
auth.delete("/session-key", requireAuth, async (c) => {
	const repo = c.get("repo") as Repository;
	const sessionId = c.get("sessionId") as string;
	const walletAddress = c.get("walletAddress") as string;

	await repo.deleteSessionKey(sessionId);
	abortPromotionsForWallet(walletAddress);
	await repo.logAudit(walletAddress, "revoked");

	return c.json({ sessionKeyActive: false });
});

export { auth as authRoutes };

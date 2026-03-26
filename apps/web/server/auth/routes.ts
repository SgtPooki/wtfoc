import { Hono } from "hono";
import type { AppEnv } from "../hono-app.js";
import type { Repository } from "../db/index.js";
import { ipRateLimiter } from "../security/rate-limit.js";
import { generateChallenge, verifySignature } from "./siwe.js";
import { generateCookieToken, setSessionCookie, clearSessionCookie } from "./session.js";
import { requireAuth } from "./middleware.js";

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

/** POST /api/auth/disconnect — Invalidate session cookie */
auth.post("/disconnect", requireAuth, async (c) => {
	const repo = c.get("repo") as Repository;
	const sessionId = c.get("sessionId") as string;

	await repo.revokeSession(sessionId);
	clearSessionCookie(c);

	return c.json({ disconnected: true });
});

export { auth as authRoutes };

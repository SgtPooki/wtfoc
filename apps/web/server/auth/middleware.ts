import type { Context, Next } from "hono";
import { SessionExpiredError } from "@wtfoc/common";
import type { Repository } from "../db/index.js";
import { getSessionCookie } from "./session.js";

/**
 * Auth middleware: reads session cookie, validates against repository,
 * attaches walletAddress and sessionId to context.
 */
export async function requireAuth(c: Context, next: Next): Promise<void | Response> {
	const token = getSessionCookie(c);
	if (!token) {
		return c.json({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401);
	}

	const repo = c.get("repo") as Repository;
	const session = await repo.getSessionByToken(token);
	if (!session) {
		return c.json({ error: "Invalid or expired session", code: "SESSION_EXPIRED" }, 401);
	}

	if (session.revokedAt) {
		throw new SessionExpiredError(session.walletAddress);
	}

	// Update last-used timestamp (fire-and-forget)
	repo.touchSession(session.id).catch(() => {});

	c.set("walletAddress", session.walletAddress);
	c.set("sessionId", session.id);
	await next();
}

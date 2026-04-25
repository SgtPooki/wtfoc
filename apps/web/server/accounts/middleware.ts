/**
 * Hono middleware for Auth.js account-protected routes.
 *
 *   requireUser  — request must carry a valid Auth.js session
 *   requireAdmin — session user must have role='admin' in DB
 *
 * `requireAdmin` reads the role straight from the session (which is sourced
 * from `users.role` via the session callback in ./config.ts), so demoting an
 * admin in the DB takes effect on their next request — no cache, no token
 * staleness window past the existing Auth.js session refresh interval.
 */

import { getAuthUser } from "@hono/auth-js";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../hono-app.js";

export interface AccountsSessionUser {
	id: string;
	email?: string | null;
	name?: string | null;
	image?: string | null;
	role: "user" | "admin";
}

export async function getAccountsUser(
	c: Parameters<MiddlewareHandler<AppEnv>>[0],
): Promise<AccountsSessionUser | null> {
	const authUser = await getAuthUser(c);
	const user = authUser?.session?.user as
		| { id?: string; email?: string | null; name?: string | null; image?: string | null; role?: string }
		| undefined;
	if (!user?.id) return null;
	const role = user.role === "admin" ? "admin" : "user";
	return {
		id: user.id,
		email: user.email ?? null,
		name: user.name ?? null,
		image: user.image ?? null,
		role,
	};
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
	const user = await getAccountsUser(c);
	if (!user) {
		return c.json({ error: "authentication required", code: "UNAUTHENTICATED" }, 401);
	}
	c.set("accountsUser", user);
	await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
	const user = await getAccountsUser(c);
	if (!user) {
		return c.json({ error: "authentication required", code: "UNAUTHENTICATED" }, 401);
	}
	if (user.role !== "admin") {
		return c.json({ error: "admin only", code: "FORBIDDEN" }, 403);
	}
	c.set("accountsUser", user);
	await next();
};

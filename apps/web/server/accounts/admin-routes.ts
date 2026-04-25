/**
 * Admin-only sub-routes for user management. Mounted at
 * /api/accounts/admin/* under the existing accounts router so they
 * share the Auth.js session lookup. Never expose anything here that
 * a regular user can call — `requireAdmin` runs first, period.
 *
 * Guardrails (defense in depth):
 *  - Refuses to demote the last remaining admin (you can't lock yourself out)
 *  - Refuses self-demote in a single request (use a peer admin to demote you)
 */

import { Hono } from "hono";
import type pg from "pg";
import type { AppEnv } from "../hono-app.js";
import { requireAdmin } from "./middleware.js";
import { countAdmins, listUsers, updateUserRole, type UserRole } from "./users-repo.js";

export interface AdminRoutesInputs {
	pool: pg.Pool;
}

const VALID_ROLES = new Set<UserRole>(["user", "admin"]);

export function createAdminRoutes(inputs: AdminRoutesInputs): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	app.use("*", requireAdmin);

	app.get("/users", async (c) => {
		const users = await listUsers(inputs.pool);
		return c.json({ users });
	});

	app.patch("/users/:id/role", async (c) => {
		const id = c.req.param("id");
		const body = await c.req.json<{ role?: string }>();
		const role = body.role as UserRole | undefined;
		if (!role || !VALID_ROLES.has(role)) {
			return c.json({ error: "role must be 'user' or 'admin'", code: "INVALID_ROLE" }, 400);
		}

		const acting = c.get("accountsUser");
		if (!acting) {
			return c.json({ error: "missing acting user", code: "INTERNAL_ERROR" }, 500);
		}

		if (role === "user" && acting.id === id) {
			return c.json(
				{
					error: "cannot demote yourself; ask another admin",
					code: "SELF_DEMOTE_FORBIDDEN",
				},
				400,
			);
		}

		if (role === "user") {
			const admins = await countAdmins(inputs.pool);
			if (admins <= 1) {
				return c.json(
					{
						error: "cannot demote the last admin",
						code: "LAST_ADMIN_FORBIDDEN",
					},
					400,
				);
			}
		}

		const updated = await updateUserRole(inputs.pool, id, role);
		if (!updated) {
			return c.json({ error: "user not found", code: "NOT_FOUND" }, 404);
		}
		return c.json({ user: updated });
	});

	return app;
}

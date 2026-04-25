/**
 * Auth.js Hono sub-app. Mounted at `/api/accounts/*`. Every request under
 * this prefix flows through `initAuthConfig` → `authHandler`, which owns
 * `/signin`, `/signout`, `/callback/:provider`, `/session`, `/csrf`,
 * `/providers`, `/verify-request`, `/error`. See @hono/auth-js for the
 * full route list.
 *
 * We intentionally don't mount Auth.js at `/api/auth/*` because that prefix
 * is already owned by the wallet (SIWE) auth flow in apps/web/server/auth/.
 * Client code must pass `basePath: '/api/accounts'` to Auth.js client helpers.
 */

import { Hono } from "hono";
import { authHandler, initAuthConfig } from "@hono/auth-js";
import type { AppEnv } from "../hono-app.js";
import { createAdminRoutes } from "./admin-routes.js";
import { buildAccountsConfig } from "./config.js";
import type pg from "pg";

export interface AccountsRoutesInputs {
	pool: pg.Pool;
}

/**
 * Construct the /api/accounts/* router. Reads Auth.js env vars lazily per
 * request (initAuthConfig is called each request with a fresh config
 * factory), so rotating Resend keys via secret reload doesn't require a
 * pod restart.
 */
export function createAccountsRoutes(inputs: AccountsRoutesInputs): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.use(
		"*",
		initAuthConfig(() => {
			const resendApiKey = process.env.RESEND_API_KEY;
			const emailFrom = process.env.AUTH_EMAIL_FROM;
			const authSecret = process.env.AUTH_SECRET;

			if (!resendApiKey || resendApiKey === "REPLACE_ME_WITH_RESEND_API_KEY") {
				throw new Error("RESEND_API_KEY is not set");
			}
			if (!emailFrom) throw new Error("AUTH_EMAIL_FROM is not set");
			if (!authSecret) throw new Error("AUTH_SECRET is not set");

			return buildAccountsConfig({
				pool: inputs.pool,
				resendApiKey,
				emailFrom,
				authSecret,
			});
		}),
	);

	// Admin sub-app must be mounted before authHandler, otherwise Auth.js
	// 400s any path it doesn't recognize as one of its own actions.
	app.route("/admin", createAdminRoutes({ pool: inputs.pool }));

	app.use("*", authHandler());

	return app;
}

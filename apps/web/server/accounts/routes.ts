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
import { SiweNonceStore } from "./siwe-nonce-store.js";
import { createSiweRoutes } from "./siwe-routes.js";
import type pg from "pg";

// Filecoin mainnet (314) + calibration (314159). Override via env if more
// chains are ever supported.
const DEFAULT_ALLOWED_CHAIN_IDS = [314, 314159];

function resolveSiweSettings(): { domain: string; uri: string; allowedChainIds: number[] } {
	const authUrl = process.env.AUTH_URL ?? "https://wtfoc.xyz";
	const parsed = new URL(authUrl);
	const domain = process.env.AUTH_SIWE_DOMAIN ?? parsed.host;
	const uri = process.env.AUTH_SIWE_URI ?? authUrl.replace(/\/$/, "");
	const allowedChainIds = process.env.AUTH_SIWE_CHAIN_IDS
		? process.env.AUTH_SIWE_CHAIN_IDS.split(",").map((s) => Number.parseInt(s.trim(), 10)).filter(Number.isFinite)
		: DEFAULT_ALLOWED_CHAIN_IDS;
	return { domain, uri, allowedChainIds };
}

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
	const nonceStore = new SiweNonceStore(inputs.pool);
	const siweSettings = resolveSiweSettings();

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
				siwe: {
					nonceStore,
					domain: siweSettings.domain,
					uri: siweSettings.uri,
					allowedChainIds: siweSettings.allowedChainIds,
				},
			});
		}),
	);

	// Admin + SIWE sub-apps must be mounted before authHandler, otherwise
	// Auth.js 400s any path it doesn't recognize as one of its own actions.
	app.route("/admin", createAdminRoutes({ pool: inputs.pool }));
	app.route("/siwe", createSiweRoutes({
		nonceStore,
		domain: siweSettings.domain,
		uri: siweSettings.uri,
		allowedChainIds: siweSettings.allowedChainIds,
	}));

	app.use("*", authHandler());

	return app;
}

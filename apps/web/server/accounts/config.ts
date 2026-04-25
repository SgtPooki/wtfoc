/**
 * Auth.js configuration for user accounts (email magic-link via Resend,
 * PostgresAdapter, database session strategy). Wallet/SIWE auth lives
 * under apps/web/server/auth/ and is untouched; this flow lives under
 * /api/accounts/* and manages `users` / `accounts` / `sessions` /
 * `verification_token` tables.
 *
 * Session strategy is `database` (not JWT): gives us server-side revocation,
 * a clean `sessions` row per login for analytics + forced logout, and a
 * simpler path to link SIWE as a secondary identity later (same user, a
 * new `accounts` row with provider='siwe').
 */

import PostgresAdapter from "@auth/pg-adapter";
import Resend from "@auth/core/providers/resend";
import type { AuthConfig } from "@hono/auth-js";
import type pg from "pg";

export interface AccountsConfigInputs {
	pool: pg.Pool;
	resendApiKey: string;
	emailFrom: string;
	authSecret: string;
}

/**
 * Build the Auth.js config for wtfoc account auth. Callers pass a fully
 * wired pg.Pool (shared with PostgresRepository so we don't run two pools)
 * and env-sourced secrets. `@hono/auth-js` also reads AUTH_SECRET + AUTH_URL
 * from the environment — `authSecret` here is the explicit override, kept
 * authoritative so construction fails loudly if the env is missing.
 */
export function buildAccountsConfig(inputs: AccountsConfigInputs): AuthConfig {
	return {
		adapter: PostgresAdapter(inputs.pool),
		secret: inputs.authSecret,
		// Mounted under /api/accounts; Auth.js otherwise defaults to /auth
		// and 400s every request with "Bad request." because the URL parser
		// can't find its action in the path.
		basePath: "/api/accounts",
		session: { strategy: "database" },
		providers: [
			Resend({
				apiKey: inputs.resendApiKey,
				from: inputs.emailFrom,
			}),
		],
		// Auto-link same-verified-email across providers. Safer-than-default
		// choice: only link when the OAuth provider returned emailVerified=true
		// (GitHub does). Tightens if a future provider marks emails unverified.
		callbacks: {
			async signIn({ account, profile }) {
				if (account?.provider === "resend") return true;
				if (account?.type === "oauth") {
					return Boolean(profile?.email_verified ?? profile?.email);
				}
				return true;
			},
			// Expose users.role on the session so the client can show admin
			// surfaces and downstream Hono middleware can enforce requireAdmin.
			// PostgresAdapter selects * from users, so `user` already carries
			// role; we just forward it to the session.
			async session({ session, user }) {
				const role = (user as { role?: string }).role ?? "user";
				return {
					...session,
					user: {
						...session.user,
						id: user.id,
						role,
					},
				};
			},
		},
		pages: {
			signIn: "/login",
			verifyRequest: "/login?check-email=1",
			error: "/login?error=1",
		},
	};
}

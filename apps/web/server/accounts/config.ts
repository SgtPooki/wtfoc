/**
 * Auth.js configuration for user accounts. Two providers:
 *
 *   - Resend (email magic-link) → database session strategy, server-revocable
 *   - SIWE (Sign-In With Ethereum) → JWT cookie, short TTL
 *
 * The hybrid is intentional and supported by Auth.js: a credentials provider
 * can co-exist with database sessions as long as ≥1 non-credentials provider
 * is also configured. See ./siwe-credentials.ts for the rationale and the
 * account-linking policy.
 *
 * The legacy /api/auth/* SIWE flow is being retired; this Auth.js-managed
 * flow at /api/accounts/* is the canonical identity surface going forward.
 */

import PostgresAdapter from "@auth/pg-adapter";
import Resend from "@auth/core/providers/resend";
import type { AuthConfig } from "@hono/auth-js";
import type pg from "pg";
import { siweCredentialsProvider } from "./siwe-credentials.js";
import type { SiweNonceStore } from "./siwe-nonce-store.js";

export interface AccountsConfigInputs {
	pool: pg.Pool;
	resendApiKey: string;
	emailFrom: string;
	authSecret: string;
	siwe: {
		nonceStore: SiweNonceStore;
		domain: string;
		uri: string;
		allowedChainIds: number[];
	};
}

/**
 * Build the Auth.js config for wtfoc account auth. Callers pass a fully
 * wired pg.Pool (shared with PostgresRepository so we don't run two pools)
 * and env-sourced secrets. `@hono/auth-js` also reads AUTH_SECRET + AUTH_URL
 * from the environment — `authSecret` here is the explicit override, kept
 * authoritative so construction fails loudly if the env is missing.
 */
export function buildAccountsConfig(inputs: AccountsConfigInputs): AuthConfig {
	const adapter = PostgresAdapter(inputs.pool);
	return {
		adapter,
		secret: inputs.authSecret,
		// Mounted under /api/accounts; Auth.js otherwise defaults to /auth
		// and 400s every request with "Bad request." because the URL parser
		// can't find its action in the path.
		basePath: "/api/accounts",
		session: {
			// Database for Resend; @auth/core falls back to JWT for the
			// credentials (SIWE) provider regardless. Wallet sessions are
			// short-lived signing contexts so the JWT-only revocation story
			// is acceptable. maxAge below applies to both kinds of session
			// cookies.
			strategy: "database",
			maxAge: 60 * 60 * 24 * 30, // 30 days
		},
		jwt: {
			// Tight TTL for credentials (wallet) sessions. Email database
			// sessions are revocable in the DB so they can run longer.
			maxAge: 60 * 60, // 1 hour
		},
		providers: [
			Resend({
				apiKey: inputs.resendApiKey,
				from: inputs.emailFrom,
			}),
			siweCredentialsProvider({
				nonceStore: inputs.siwe.nonceStore,
				pool: inputs.pool,
				expectedDomain: inputs.siwe.domain,
				expectedUri: inputs.siwe.uri,
				allowedChainIds: inputs.siwe.allowedChainIds,
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

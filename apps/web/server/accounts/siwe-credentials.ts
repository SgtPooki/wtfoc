/**
 * Sign-In With Ethereum (SIWE, EIP-4361) as an Auth.js credentials provider.
 *
 * # Why credentials and not OAuth
 * @auth/core has no first-class SIWE provider. Wrapping SIWE as a fake
 * OAuth provider would require running a fake authorization server inside
 * wtfoc — far more code than a credentials provider. Auth.js explicitly
 * permits credentials providers alongside database session strategies as
 * long as ≥1 non-credentials provider is also configured (see
 * @auth/core/lib/utils/assert.ts:115). We have Resend (email), so this
 * combination is supported.
 *
 * # Hybrid session model
 * - Email sign-ins → row in `sessions` table → server-revocable.
 * - Wallet (SIWE) sign-ins → JWT cookie → not server-revocable.
 *
 * The asymmetry is intentional: wallet sessions are short-lived signing
 * contexts, email sessions are long-lived identity. The credentials JWT
 * TTL is set tight (1h) to compensate for the lack of revocation.
 *
 * # Account linking policy
 * SIWE never auto-links to an existing email user by heuristic. The only
 * paths that link a wallet to an existing user are:
 *   1. The user is signed in (Auth.js session present) when they sign the
 *      SIWE message; the credentials provider sees the existing session
 *      cookie and writes a new `accounts(provider='siwe')` row for them.
 *   2. Explicit linking flow from /account (future).
 *
 * Otherwise, a wallet sign-in with no prior link creates a new wallet-only
 * Auth.js user (`email=null`). Same human signing up via email then via
 * wallet on different days = two separate users. Codex called this out as
 * the load-bearing design decision; refusing to auto-merge is the safe
 * default.
 *
 * # Hardening (vs the previous /api/auth/* SIWE flow)
 * - Validates domain, URI, chain ID, issuedAt, expirationTime via the
 *   `siwe` library's SiweMessage.verify() — not a hand-rolled regex.
 * - Nonce store is durable (Postgres) and address-bound; nonces are
 *   atomically consumed (one-time use) and rejected if expired or
 *   issued for a different wallet.
 */

import Credentials from "@auth/core/providers/credentials";
import type { AdapterUser } from "@auth/core/adapters";
import type pg from "pg";
import { SiweMessage } from "siwe";
import type { SiweNonceStore } from "./siwe-nonce-store.js";

export interface SiweProviderInputs {
	nonceStore: SiweNonceStore;
	pool: pg.Pool;
	/** Allowed message domain — typically the public hostname (`wtfoc.xyz`). */
	expectedDomain: string;
	/** Allowed message URI — typically `https://wtfoc.xyz`. */
	expectedUri: string;
	/** Allowed chain IDs — Filecoin mainnet 314 + calibration 314159. */
	allowedChainIds: number[];
}

interface CredentialsInput {
	message?: string;
	signature?: string;
}

export function siweCredentialsProvider(inputs: SiweProviderInputs) {
	return Credentials({
		id: "siwe",
		name: "Ethereum",
		credentials: {
			message: { label: "Message", type: "text" },
			signature: { label: "Signature", type: "text" },
		},
		async authorize(credentials): Promise<AdapterUser | null> {
			const { message, signature } = (credentials ?? {}) as CredentialsInput;
			if (typeof message !== "string" || typeof signature !== "string") {
				return null;
			}

			let parsed: SiweMessage;
			try {
				parsed = new SiweMessage(message);
			} catch {
				return null;
			}

			if (!inputs.allowedChainIds.includes(parsed.chainId)) return null;

			const verifyResult = await parsed.verify({
				signature,
				domain: inputs.expectedDomain,
				nonce: parsed.nonce,
				time: new Date().toISOString(),
			});

			if (!verifyResult.success) return null;
			if (parsed.uri !== inputs.expectedUri) return null;

			const consumed = await inputs.nonceStore.consume(parsed.nonce, parsed.address);
			if (!consumed) return null;

			const wallet = parsed.address.toLowerCase();
			return upsertSiweUser(inputs.pool, wallet);
		},
	});
}

interface UserRow {
	id: string;
	email: string | null;
	name: string | null;
	emailVerified: string | Date | null;
	image: string | null;
}

function rowToAdapterUser(row: UserRow): AdapterUser {
	return {
		id: row.id,
		// Auth.js's AdapterUser type insists email is a string. For wallet-only
		// users the column is null in DB; we pass an empty string up to Auth.js
		// so type-checks pass, then the session callback in config.ts surfaces
		// the real value (or absence) from a fresh users-table read.
		email: row.email ?? "",
		emailVerified: row.emailVerified ? new Date(row.emailVerified) : null,
		name: row.name,
		image: row.image,
	};
}

/**
 * Upsert flow (raw SQL, not the @auth/pg-adapter):
 * 1. Look up users via accounts(provider='siwe', providerAccountId=wallet).
 *    Found → return that user.
 * 2. No prior link → create user + accounts row in a single transaction.
 *
 * @auth/core's `AdapterAccountType` explicitly excludes 'credentials', so
 * adapter.linkAccount() refuses to write our accounts row. We own the
 * accounts table semantics here — provider='siwe' is a wtfoc-specific row
 * shape that Auth.js's adapter never tries to read for sign-in (it doesn't
 * know SIWE), so writing it directly is safe.
 *
 * We never look up by email here — that's the safe default refusing
 * heuristic cross-method merges. Linking to an existing authenticated
 * email user happens via a separate /api/accounts/siwe/link flow (TODO).
 */
async function upsertSiweUser(pool: pg.Pool, wallet: string): Promise<AdapterUser | null> {
	const existing = await pool.query<UserRow>(
		`SELECT u.id, u.email, u.name, u."emailVerified", u.image
		   FROM users u
		   JOIN accounts a ON a."userId" = u.id
		  WHERE a.provider = 'siwe' AND lower(a."providerAccountId") = $1`,
		[wallet],
	);
	if (existing.rows[0]) return rowToAdapterUser(existing.rows[0]);

	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const userResult = await client.query<UserRow>(
			`INSERT INTO users (email, name, image)
			 VALUES (NULL, $1, NULL)
			 RETURNING id, email, name, "emailVerified", image`,
			[`${wallet.slice(0, 6)}…${wallet.slice(-4)}`],
		);
		const userRow = userResult.rows[0];
		if (!userRow) throw new Error("user insert returned no row");

		await client.query(
			`INSERT INTO accounts ("userId", type, provider, "providerAccountId")
			 VALUES ($1, 'siwe', 'siwe', $2)`,
			[userRow.id, wallet],
		);
		await client.query("COMMIT");
		return rowToAdapterUser(userRow);
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
}

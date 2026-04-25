/**
 * SIWE-specific endpoints under /api/accounts/siwe/*. Only exposes the
 * challenge issuer; verification + sign-in goes through Auth.js's standard
 * /api/accounts/callback/credentials/siwe POST (handled by authHandler()).
 *
 *   GET /api/accounts/siwe/challenge?address=0x…&chainId=314
 *     → { nonce, message, expiresAt }
 *
 * The client signs the returned EIP-4361 message locally, then POSTs
 * { message, signature } to /api/accounts/callback/credentials/siwe with
 * the standard Auth.js CSRF token.
 */

import { Hono } from "hono";
import type pg from "pg";
import { SiweMessage } from "siwe";
import { getAddress } from "viem";
import type { AppEnv } from "../hono-app.js";
import { ipRateLimiter } from "../security/rate-limit.js";
import { requireUser } from "./middleware.js";
import type { SiweNonceStore } from "./siwe-nonce-store.js";

export interface SiweRoutesInputs {
	nonceStore: SiweNonceStore;
	pool: pg.Pool;
	domain: string;
	uri: string;
	allowedChainIds: number[];
}

const challengeRateLimit = ipRateLimiter(20, 60);

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function createSiweRoutes(inputs: SiweRoutesInputs): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.get("/challenge", challengeRateLimit.middleware(), async (c) => {
		const rawAddress = c.req.query("address") ?? "";
		const chainIdRaw = c.req.query("chainId") ?? "";

		if (!ADDRESS_REGEX.test(rawAddress)) {
			return c.json({ error: "valid 0x address required", code: "INVALID_ADDRESS" }, 400);
		}

		// EIP-4361 / SiweMessage rejects addresses that aren't EIP-55 checksum
		// cased. Wallets (Ledger, MetaMask in some flows) hand back lowercase.
		// Always normalize via viem.getAddress() so the caller doesn't have to.
		let address: `0x${string}`;
		try {
			address = getAddress(rawAddress);
		} catch {
			return c.json({ error: "invalid Ethereum address", code: "INVALID_ADDRESS" }, 400);
		}

		const chainId = Number.parseInt(chainIdRaw, 10);
		if (!Number.isFinite(chainId) || !inputs.allowedChainIds.includes(chainId)) {
			return c.json(
				{
					error: `chainId must be one of ${inputs.allowedChainIds.join(", ")}`,
					code: "INVALID_CHAIN_ID",
				},
				400,
			);
		}

		// Construct the SIWE message FIRST — if the message body is invalid we
		// surface the error before persisting a nonce, so the DB doesn't
		// accumulate orphaned rows on bad input.
		let message: string;
		try {
			message = new SiweMessage({
				domain: inputs.domain,
				address,
				statement: "Sign in to wtfoc.xyz",
				uri: inputs.uri,
				version: "1",
				chainId,
				// Placeholder nonce — replaced after issue() below. We pass a
				// 16-char hex stand-in only so the SiweMessage constructor's
				// nonce-length check passes during this validation pass.
				nonce: "0".repeat(16),
				issuedAt: new Date().toISOString(),
				expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
			}).prepareMessage();
		} catch (err) {
			return c.json(
				{
					error: err instanceof Error ? err.message : "invalid SIWE message",
					code: "INVALID_SIWE_MESSAGE",
				},
				400,
			);
		}

		const issued = await inputs.nonceStore.issue(address);

		message = new SiweMessage({
			domain: inputs.domain,
			address,
			statement: "Sign in to wtfoc.xyz",
			uri: inputs.uri,
			version: "1",
			chainId,
			nonce: issued.nonce,
			issuedAt: new Date().toISOString(),
			expirationTime: issued.expiresAt.toISOString(),
		}).prepareMessage();

		return c.json({
			nonce: issued.nonce,
			message,
			expiresAt: issued.expiresAt.toISOString(),
		});
	});

	/**
	 * POST /api/accounts/siwe/link
	 *
	 * Link a wallet to the currently signed-in Auth.js user. Distinct from
	 * the Auth.js credentials sign-in callback, which creates a NEW wallet-
	 * only user — that's wrong for "link" semantics where the user is
	 * already authenticated and just wants to add a wallet to their account.
	 *
	 * Body: { message, signature }
	 * Auth: requireUser (existing Auth.js session cookie)
	 */
	app.post("/link", requireUser, async (c) => {
		const acting = c.get("accountsUser");
		if (!acting) {
			return c.json({ error: "missing user", code: "UNAUTHENTICATED" }, 401);
		}

		type LinkBody = { message?: string; signature?: string };
		const body = await c.req
			.json<LinkBody>()
			.catch((): LinkBody => ({}));
		if (typeof body.message !== "string" || typeof body.signature !== "string") {
			return c.json({ error: "message + signature required", code: "INVALID_BODY" }, 400);
		}

		let parsed: SiweMessage;
		try {
			parsed = new SiweMessage(body.message);
		} catch (err) {
			return c.json(
				{
					error: err instanceof Error ? err.message : "invalid SIWE message",
					code: "INVALID_SIWE_MESSAGE",
				},
				400,
			);
		}

		if (!inputs.allowedChainIds.includes(parsed.chainId)) {
			return c.json({ error: "chain not allowed", code: "INVALID_CHAIN_ID" }, 400);
		}
		if (parsed.uri !== inputs.uri) {
			return c.json({ error: "URI mismatch", code: "INVALID_SIWE_MESSAGE" }, 400);
		}

		const verifyResult = await parsed.verify({
			signature: body.signature,
			domain: inputs.domain,
			nonce: parsed.nonce,
			time: new Date().toISOString(),
		});
		if (!verifyResult.success) {
			return c.json({ error: "signature verification failed", code: "INVALID_SIGNATURE" }, 400);
		}

		const consumed = await inputs.nonceStore.consume(parsed.nonce, parsed.address);
		if (!consumed) {
			return c.json({ error: "nonce expired or already used", code: "INVALID_NONCE" }, 400);
		}

		const wallet = parsed.address.toLowerCase();

		// Refuse to link a wallet that's already attached to a *different* user.
		const taken = await inputs.pool.query<{ userId: string }>(
			`SELECT "userId" FROM accounts WHERE provider = 'siwe' AND lower("providerAccountId") = $1`,
			[wallet],
		);
		const existing = taken.rows[0];
		if (existing) {
			if (existing.userId === acting.id) {
				return c.json({ ok: true, alreadyLinked: true });
			}
			return c.json(
				{
					error: "wallet is already linked to a different account",
					code: "WALLET_ALREADY_LINKED",
				},
				409,
			);
		}

		await inputs.pool.query(
			`INSERT INTO accounts ("userId", type, provider, "providerAccountId")
			 VALUES ($1, 'siwe', 'siwe', $2)`,
			[acting.id, wallet],
		);

		return c.json({ ok: true, wallet });
	});

	/**
	 * GET /api/accounts/siwe/wallets
	 *
	 * List wallets linked to the current user. Used by /account to render
	 * the list of linked wallets under the Connections block.
	 */
	app.get("/wallets", requireUser, async (c) => {
		const acting = c.get("accountsUser");
		if (!acting) {
			return c.json({ error: "missing user", code: "UNAUTHENTICATED" }, 401);
		}
		const result = await inputs.pool.query<{ providerAccountId: string }>(
			`SELECT "providerAccountId" FROM accounts
			   WHERE provider = 'siwe' AND "userId" = $1
			   ORDER BY "providerAccountId"`,
			[acting.id],
		);
		return c.json({ wallets: result.rows.map((r) => r.providerAccountId) });
	});

	/**
	 * DELETE /api/accounts/siwe/wallets/:address
	 *
	 * Unlink a wallet from the current user. Refuses to unlink the LAST
	 * sign-in method on a user with no email — locking yourself out.
	 */
	app.delete("/wallets/:address", requireUser, async (c) => {
		const acting = c.get("accountsUser");
		if (!acting) {
			return c.json({ error: "missing user", code: "UNAUTHENTICATED" }, 401);
		}
		const wallet = c.req.param("address").toLowerCase();
		if (!ADDRESS_REGEX.test(wallet)) {
			return c.json({ error: "invalid address", code: "INVALID_ADDRESS" }, 400);
		}

		// Lockout guard: if user has no email, they can only sign in via wallet.
		// Refuse to unlink their last wallet.
		if (!acting.email) {
			const count = await inputs.pool.query<{ n: string }>(
				`SELECT count(*)::text AS n FROM accounts WHERE provider = 'siwe' AND "userId" = $1`,
				[acting.id],
			);
			if (Number(count.rows[0]?.n ?? "0") <= 1) {
				return c.json(
					{
						error: "cannot unlink the last wallet on a wallet-only account",
						code: "LOCKOUT_FORBIDDEN",
					},
					400,
				);
			}
		}

		const result = await inputs.pool.query(
			`DELETE FROM accounts
			   WHERE provider = 'siwe' AND "userId" = $1
			     AND lower("providerAccountId") = $2`,
			[acting.id, wallet],
		);
		if (result.rowCount === 0) {
			return c.json({ error: "wallet not linked to this user", code: "NOT_FOUND" }, 404);
		}
		return c.json({ ok: true });
	});

	return app;
}

/**
 * Durable, address-bound, single-use SIWE nonce store backed by the
 * `siwe_nonces` Postgres table. Replaces the previous in-memory Map that
 * couldn't survive a pod restart and didn't bind nonces to addresses
 * (so a leaked nonce could be reused by an attacker for a different wallet).
 *
 * Lifecycle:
 *   issue()   — create a fresh nonce, bind it to the address, persist with TTL
 *   consume() — atomically claim the nonce (one-time use); fails if already
 *               consumed, expired, or the address doesn't match
 *   gc()      — remove rows past expiration (caller schedules)
 */

import { randomBytes } from "node:crypto";
import type pg from "pg";

const NONCE_TTL_SECONDS = 5 * 60;

export interface IssuedNonce {
	nonce: string;
	expiresAt: Date;
}

export class SiweNonceStore {
	readonly #pool: pg.Pool;

	constructor(pool: pg.Pool) {
		this.#pool = pool;
	}

	/** Issue a fresh nonce bound to `address` (lowercased) with a 5-min TTL. */
	async issue(address: string): Promise<IssuedNonce> {
		const nonce = randomBytes(16).toString("hex");
		const result = await this.#pool.query<{ expires_at: string }>(
			`INSERT INTO siwe_nonces (nonce, address, expires_at)
			 VALUES ($1, $2, now() + ($3 || ' seconds')::interval)
			 RETURNING expires_at`,
			[nonce, address.toLowerCase(), String(NONCE_TTL_SECONDS)],
		);
		const row = result.rows[0];
		if (!row) throw new Error("siwe_nonces insert returned no row");
		return { nonce, expiresAt: new Date(row.expires_at) };
	}

	/**
	 * Atomically consume a nonce. Returns true on success; false if the
	 * nonce doesn't exist, has expired, has already been consumed, or
	 * was issued for a different address.
	 *
	 * The single UPDATE … WHERE consumed_at IS NULL guards against double
	 * consumption under concurrent attempts on the same nonce — the second
	 * UPDATE finds no matching row.
	 */
	async consume(nonce: string, address: string): Promise<boolean> {
		const result = await this.#pool.query<{ ok: boolean }>(
			`UPDATE siwe_nonces
			   SET consumed_at = now()
			 WHERE nonce = $1
			   AND lower(address) = lower($2)
			   AND consumed_at IS NULL
			   AND expires_at > now()
			 RETURNING true AS ok`,
			[nonce, address],
		);
		return result.rowCount === 1;
	}

	async gc(): Promise<number> {
		const result = await this.#pool.query(
			`DELETE FROM siwe_nonces WHERE expires_at < now() - interval '1 day'`,
		);
		return result.rowCount ?? 0;
	}
}

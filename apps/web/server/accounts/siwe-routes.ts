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
import { SiweMessage } from "siwe";
import type { AppEnv } from "../hono-app.js";
import { ipRateLimiter } from "../security/rate-limit.js";
import type { SiweNonceStore } from "./siwe-nonce-store.js";

export interface SiweRoutesInputs {
	nonceStore: SiweNonceStore;
	domain: string;
	uri: string;
	allowedChainIds: number[];
}

const challengeRateLimit = ipRateLimiter(20, 60);

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function createSiweRoutes(inputs: SiweRoutesInputs): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.get("/challenge", challengeRateLimit.middleware(), async (c) => {
		const address = c.req.query("address") ?? "";
		const chainIdRaw = c.req.query("chainId") ?? "";

		if (!ADDRESS_REGEX.test(address)) {
			return c.json({ error: "valid 0x address required", code: "INVALID_ADDRESS" }, 400);
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

		const issued = await inputs.nonceStore.issue(address);

		const message = new SiweMessage({
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

	return app;
}

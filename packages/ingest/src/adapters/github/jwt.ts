/**
 * Minimal GitHub App JWT signing using Node.js crypto.
 * No external dependencies — RS256 only (what GitHub requires).
 */

import { createSign } from "node:crypto";

function base64url(data: string | Buffer): string {
	const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
	return buf.toString("base64url");
}

export interface GitHubAppJwtOptions {
	/** GitHub App ID (numeric string) */
	appId: string;
	/** PEM-encoded RSA private key (or base64-encoded PEM) */
	privateKey: string;
	/** JWT lifetime in seconds (default 600 = 10 minutes, GitHub max) */
	expiresInSeconds?: number;
}

/**
 * Decode a private key that may be base64-encoded.
 * Supports both raw PEM and base64-wrapped PEM.
 */
export function decodePrivateKey(key: string): string {
	if (key.startsWith("-----BEGIN")) return key;
	// Assume base64-encoded PEM
	return Buffer.from(key, "base64").toString("utf8");
}

/**
 * Sign a JWT for GitHub App authentication (RS256).
 *
 * The resulting JWT is used to:
 * - `GET /app` to verify the app
 * - `POST /app/installations/{id}/access_tokens` to get installation tokens
 *
 * GitHub requires: iss = app ID, iat = now - 60s (clock drift), exp = 10min max.
 */
export function signGitHubAppJwt(options: GitHubAppJwtOptions): string {
	const now = Math.floor(Date.now() / 1000);
	const expiresIn = options.expiresInSeconds ?? 600;

	const header = { alg: "RS256", typ: "JWT" };
	const payload = {
		iss: options.appId,
		iat: now - 60, // 60s clock drift allowance
		exp: now + expiresIn,
	};

	const segments = [base64url(JSON.stringify(header)), base64url(JSON.stringify(payload))];
	const signingInput = segments.join(".");

	const pem = decodePrivateKey(options.privateKey);
	const signer = createSign("RSA-SHA256");
	signer.update(signingInput);
	const signature = signer.sign(pem, "base64url");

	return `${signingInput}.${signature}`;
}

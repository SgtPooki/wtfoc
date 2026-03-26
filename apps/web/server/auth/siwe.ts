import { randomBytes } from "node:crypto";
import { WalletVerificationError } from "@wtfoc/common";

export interface SiweChallenge {
	nonce: string;
	message: string;
}

const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function generateChallenge(address: string, domain: string, chainId: number): SiweChallenge {
	const nonce = randomBytes(16).toString("hex");
	const issuedAt = new Date().toISOString();
	const expirationTime = new Date(Date.now() + NONCE_TTL_MS).toISOString();

	// SIWE message format per EIP-4361
	const message = [
		`${domain} wants you to sign in with your Ethereum account:`,
		address,
		"",
		"Sign in to wtfoc.xyz to manage your collections.",
		"",
		`URI: https://${domain}`,
		`Version: 1`,
		`Chain ID: ${chainId}`,
		`Nonce: ${nonce}`,
		`Issued At: ${issuedAt}`,
		`Expiration Time: ${expirationTime}`,
	].join("\n");

	nonceStore.set(nonce, { nonce, expiresAt: Date.now() + NONCE_TTL_MS });

	// Clean expired nonces periodically
	if (nonceStore.size > 1000) {
		const now = Date.now();
		for (const [key, val] of nonceStore) {
			if (now >= val.expiresAt) nonceStore.delete(key);
		}
	}

	return { nonce, message };
}

export async function verifySignature(
	message: string,
	signature: `0x${string}`,
	expectedAddress: string,
): Promise<void> {
	const { verifyMessage } = await import("viem");

	// Extract nonce from message
	const nonceMatch = message.match(/Nonce: ([a-f0-9]+)/);
	if (!nonceMatch?.[1]) {
		throw new WalletVerificationError(expectedAddress, "Missing nonce in SIWE message");
	}

	const nonce = nonceMatch[1];
	const stored = nonceStore.get(nonce);
	if (!stored) {
		throw new WalletVerificationError(expectedAddress, "Invalid or expired nonce");
	}
	if (Date.now() >= stored.expiresAt) {
		nonceStore.delete(nonce);
		throw new WalletVerificationError(expectedAddress, "Nonce expired");
	}

	// Verify the signature matches the expected address
	const valid = await verifyMessage({
		address: expectedAddress as `0x${string}`,
		message,
		signature,
	});

	if (!valid) {
		throw new WalletVerificationError(expectedAddress, "Signature does not match address");
	}

	// Consume nonce (one-time use)
	nonceStore.delete(nonce);
}

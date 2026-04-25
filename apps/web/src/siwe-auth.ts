/**
 * SIWE sign-in via Auth.js — talks to /api/accounts/siwe + the Auth.js
 * credentials callback. This is the identity flow ("who are you?"). The
 * legacy wallet flow in ../wallet.ts continues to manage FOC signing-key
 * delegation under /api/auth/*; the two systems are decoupled by design.
 *
 * Flow:
 *   1. Connect wallet via injected provider (eth_requestAccounts)
 *   2. GET /api/accounts/siwe/challenge → server-issued nonce + EIP-4361 message
 *   3. personal_sign the message in the wallet
 *   4. POST /api/accounts/csrf → fresh csrfToken
 *   5. POST /api/accounts/callback/credentials/siwe with csrfToken + message
 *      + signature; Auth.js verifies and either creates a wallet-only user
 *      (if no auth context) or — when an existing Auth.js session cookie
 *      is present — links the wallet to the current user.
 */

import { fetchAccountSession, session } from "./accounts.js";
import {
	connectWallet,
	getChainId,
	hasInjectedProvider,
	personalSign,
	switchChain,
} from "./wallet.js";

const FILECOIN_MAINNET_CHAIN_ID = 314;
const CALIBRATION_CHAIN_ID = 314159;
const ALLOWED_CHAIN_IDS = [FILECOIN_MAINNET_CHAIN_ID, CALIBRATION_CHAIN_ID];

interface ChallengeResponse {
	nonce: string;
	message: string;
	expiresAt: string;
}

async function fetchChallenge(address: string, chainId: number): Promise<ChallengeResponse> {
	const url = `/api/accounts/siwe/challenge?address=${encodeURIComponent(address)}&chainId=${chainId}`;
	const res = await fetch(url, { credentials: "same-origin" });
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`siwe challenge failed: ${res.status} ${body}`);
	}
	return (await res.json()) as ChallengeResponse;
}

async function fetchCsrfToken(): Promise<string> {
	const res = await fetch("/api/accounts/csrf", { credentials: "same-origin" });
	if (!res.ok) throw new Error(`csrf fetch failed: ${res.status}`);
	const body = (await res.json()) as { csrfToken: string };
	return body.csrfToken;
}

/**
 * Run the full SIWE sign-in flow. Returns the linked or newly-created
 * Auth.js user via session.value once complete; throws on any step failure.
 */
export async function signInWithWallet(): Promise<void> {
	if (!hasInjectedProvider()) {
		throw new Error("No Ethereum wallet detected. Install MetaMask or another EIP-1193 wallet.");
	}

	const accounts = await connectWallet();
	const address = accounts[0];
	if (!address) throw new Error("No accounts returned from wallet");

	let chainId = await getChainId();
	if (!ALLOWED_CHAIN_IDS.includes(chainId)) {
		try {
			await switchChain(CALIBRATION_CHAIN_ID);
			chainId = CALIBRATION_CHAIN_ID;
		} catch {
			throw new Error(
				`Please switch wallet to Filecoin (chain 314) or Calibration (chain ${CALIBRATION_CHAIN_ID}).`,
			);
		}
	}

	const challenge = await fetchChallenge(address, chainId);
	const signature = await personalSign(challenge.message, address);
	const csrfToken = await fetchCsrfToken();

	const body = new URLSearchParams({
		csrfToken,
		message: challenge.message,
		signature,
		callbackUrl: "/account",
		json: "true",
	});

	const res = await fetch("/api/accounts/callback/credentials/siwe", {
		method: "POST",
		credentials: "same-origin",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});

	if (!res.ok) {
		const errText = await res.text().catch(() => "");
		throw new Error(`SIWE sign-in failed: ${res.status} ${errText}`);
	}

	// Auth.js returns { url } on success when json=true. Refresh local session
	// state so isAdmin / role / user fields update immediately.
	const refreshed = await fetchAccountSession();
	session.value = refreshed;
}

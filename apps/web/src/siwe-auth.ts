/**
 * SIWE auth client. Two distinct flows share the prepareSignedMessage
 * step (connect wallet → challenge → sign), then diverge:
 *
 *   signInWithWallet  → POST to Auth.js /callback/credentials/siwe.
 *                       Anonymous flow. Creates a new wallet-only Auth.js
 *                       user, or returns the existing one if this wallet
 *                       is already linked. Use on /login.
 *
 *   linkWalletToAccount → POST to /api/accounts/siwe/link. Authenticated
 *                       flow. Adds an accounts(provider='siwe') row for
 *                       the current user. Use on /account.
 *
 * The legacy wallet flow in ../wallet.ts is unrelated — that handles FOC
 * signing-key delegation under /api/auth/* and stays separate.
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

async function prepareSignedMessage(): Promise<{
	address: string;
	message: string;
	signature: string;
}> {
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
	return { address, message: challenge.message, signature };
}

/**
 * Sign-in flow: anonymous user wants to authenticate with a wallet.
 * Goes through the Auth.js credentials callback, which creates a NEW
 * wallet-only user (or returns the existing one if this wallet is
 * already linked).
 */
export async function signInWithWallet(): Promise<void> {
	const { message, signature } = await prepareSignedMessage();
	const csrfToken = await fetchCsrfToken();

	const body = new URLSearchParams({
		csrfToken,
		message,
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

	const refreshed = await fetchAccountSession();
	session.value = refreshed;
}

/**
 * Link flow: authenticated user wants to add a wallet to their existing
 * account. Goes through the wtfoc-specific /api/accounts/siwe/link
 * endpoint which writes an accounts(provider='siwe') row for the current
 * user. Distinct from the sign-in flow because the credentials sign-in
 * callback would otherwise create a NEW user instead of linking.
 */
export async function linkWalletToAccount(): Promise<{ wallet: string; alreadyLinked?: boolean }> {
	const { message, signature } = await prepareSignedMessage();

	const res = await fetch("/api/accounts/siwe/link", {
		method: "POST",
		credentials: "same-origin",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ message, signature }),
	});

	const body = (await res.json().catch(() => ({}))) as {
		wallet?: string;
		ok?: boolean;
		alreadyLinked?: boolean;
		error?: string;
	};

	if (!res.ok) {
		throw new Error(body.error ?? `link failed: ${res.status}`);
	}
	return { wallet: body.wallet ?? "", alreadyLinked: body.alreadyLinked };
}

export async function fetchLinkedWallets(): Promise<string[]> {
	const res = await fetch("/api/accounts/siwe/wallets", { credentials: "same-origin" });
	if (!res.ok) return [];
	const body = (await res.json()) as { wallets: string[] };
	return body.wallets;
}

export async function unlinkWallet(wallet: string): Promise<void> {
	const res = await fetch(`/api/accounts/siwe/wallets/${encodeURIComponent(wallet)}`, {
		method: "DELETE",
		credentials: "same-origin",
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `unlink failed: ${res.status}`);
	}
}

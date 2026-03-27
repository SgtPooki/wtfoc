/** Wallet connection and SIWE auth helpers for the frontend. */

import { apiFetch } from "./api.js";

export async function requestChallenge(
	address: string,
	chainId: number,
): Promise<{ nonce: string; message: string }> {
	return apiFetch<{ nonce: string; message: string }>("/api/auth/challenge", undefined, undefined, {
		method: "POST",
		body: JSON.stringify({ address, chainId }),
	});
}

export async function verifySignature(
	message: string,
	signature: string,
	address: string,
): Promise<{ address: string; sessionKeyActive: boolean; sessionKeyExpiresAt: string | null }> {
	return apiFetch("/api/auth/verify", undefined, undefined, {
		method: "POST",
		body: JSON.stringify({ message, signature, address }),
	});
}

export async function disconnect(): Promise<void> {
	await apiFetch("/api/auth/disconnect", undefined, undefined, {
		method: "POST",
	});
}

/** Truncate an Ethereum address for display: 0x1234...abcd */
export function truncateAddress(address: string): string {
	if (address.length < 10) return address;
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Check if MetaMask or compatible wallet is available */
export function hasInjectedProvider(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof (window as unknown as { ethereum?: unknown }).ethereum !== "undefined"
	);
}

/** Get the injected Ethereum provider */
export function getProvider(): {
	request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
} | null {
	const w = window as unknown as {
		ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
	};
	return w.ethereum ?? null;
}

/** Request wallet connection and return addresses */
export async function connectWallet(): Promise<string[]> {
	const provider = getProvider();
	if (!provider) {
		throw new Error("No Ethereum wallet detected. Install MetaMask or use WalletConnect.");
	}
	const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
	return accounts;
}

/** Get current chain ID */
export async function getChainId(): Promise<number> {
	const provider = getProvider();
	if (!provider) return 0;
	const chainId = (await provider.request({ method: "eth_chainId" })) as string;
	return Number.parseInt(chainId, 16);
}

/** Request the user to sign a message */
export async function personalSign(message: string, address: string): Promise<string> {
	const provider = getProvider();
	if (!provider) throw new Error("No Ethereum wallet detected");
	const signature = (await provider.request({
		method: "personal_sign",
		params: [message, address],
	})) as string;
	return signature;
}

/** CALIBRATION_CHAIN_ID for Filecoin Calibration testnet */
export const CALIBRATION_CHAIN_ID = 314159;

/** Request the user to switch to a specific chain */
export async function switchChain(chainId: number): Promise<void> {
	const provider = getProvider();
	if (!provider) throw new Error("No Ethereum wallet detected");
	await provider.request({
		method: "wallet_switchEthereumChain",
		params: [{ chainId: `0x${chainId.toString(16)}` }],
	});
}

/** Create a viem WalletClient from the injected provider for on-chain txs */
export async function getWalletClient() {
	const { createWalletClient, custom } = await import("viem");
	const { calibration } = await import("@filoz/synapse-core/chains");
	const provider = getProvider();
	if (!provider) throw new Error("No Ethereum wallet detected");

	const accounts = (await provider.request({ method: "eth_accounts" })) as `0x${string}`[];
	const account = accounts[0];
	if (!account) throw new Error("No connected account");

	return createWalletClient({
		account,
		chain: calibration,
		transport: custom(provider as Parameters<typeof custom>[0]),
	});
}

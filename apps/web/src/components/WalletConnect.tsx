import { useState } from "preact/hooks";
import {
	chainId,
	isConnected,
	sessionKeyActive,
	sessionKeyExpiresAt,
	walletAddress,
} from "../state.js";
import {
	disconnect as apiDisconnect,
	CALIBRATION_CHAIN_ID,
	connectWallet,
	getChainId,
	hasInjectedProvider,
	personalSign,
	requestChallenge,
	switchChain,
	truncateAddress,
	verifySignature,
} from "../wallet.js";
import { SessionKeyManager } from "./SessionKeyManager.js";

export function WalletConnect() {
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const handleConnect = async () => {
		setError(null);
		setLoading(true);
		try {
			if (!hasInjectedProvider()) {
				setError("No Ethereum wallet detected. Install MetaMask or use WalletConnect.");
				return;
			}

			const accounts = await connectWallet();
			const address = accounts[0];
			if (!address) {
				setError("No accounts returned from wallet");
				return;
			}

			const currentChainId = await getChainId();
			chainId.value = currentChainId;

			// Check chain mismatch
			if (currentChainId !== CALIBRATION_CHAIN_ID) {
				try {
					await switchChain(CALIBRATION_CHAIN_ID);
					chainId.value = CALIBRATION_CHAIN_ID;
				} catch {
					setError(
						`Please switch to Filecoin Calibration testnet (chain ID ${CALIBRATION_CHAIN_ID})`,
					);
					return;
				}
			}

			// SIWE flow
			const challenge = await requestChallenge(address, CALIBRATION_CHAIN_ID);
			const signature = await personalSign(challenge.message, address);
			const result = await verifySignature(challenge.message, signature, address);

			walletAddress.value = result.address;
			isConnected.value = true;
			sessionKeyActive.value = result.sessionKeyActive;
			sessionKeyExpiresAt.value = result.sessionKeyExpiresAt;
		} catch (err) {
			const rpcErr = err as { code?: number; message?: string };
			if (rpcErr.code === 4001 || rpcErr.message?.toLowerCase().includes("user rejected")) {
				setError("Connection cancelled");
			} else {
				const msg = err instanceof Error ? err.message : (rpcErr.message ?? String(err));
				setError(msg);
			}
		} finally {
			setLoading(false);
		}
	};

	const handleDisconnect = async () => {
		setError(null);
		try {
			await apiDisconnect();
		} catch {
			// Best-effort disconnect
		}
		walletAddress.value = null;
		isConnected.value = false;
		sessionKeyActive.value = false;
		sessionKeyExpiresAt.value = null;
		chainId.value = 0;
	};

	if (isConnected.value && walletAddress.value) {
		return (
			<div class="wallet-connected">
				<span class="wallet-address" title={walletAddress.value}>
					{truncateAddress(walletAddress.value)}
				</span>
				<button type="button" class="wallet-disconnect-btn" onClick={handleDisconnect}>
					Disconnect
				</button>
				<SessionKeyManager />
			</div>
		);
	}

	return (
		<div class="wallet-connect">
			<button type="button" class="wallet-connect-btn" onClick={handleConnect} disabled={loading}>
				{loading ? "Connecting..." : "Connect Wallet"}
			</button>
			{error && <span class="wallet-error">{error}</span>}
		</div>
	);
}

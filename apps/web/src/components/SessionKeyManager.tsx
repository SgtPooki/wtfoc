import { useState } from "preact/hooks";
import { delegateSessionKey, revokeSessionKey } from "../api.js";
import { sessionKeyActive, sessionKeyExpiresAt, walletAddress } from "../state.js";
import { getWalletClient } from "../wallet.js";

export function SessionKeyManager() {
	const [loading, setLoading] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const handleDelegate = async () => {
		setError(null);
		setStatus(null);
		setLoading(true);
		try {
			const { generatePrivateKey } = await import("viem/accounts");
			const SessionKey = await import("@filoz/synapse-core/session-key");
			const { calibration } = await import("@filoz/synapse-core/chains");

			const address = walletAddress.value;
			if (!address) throw new Error("Wallet not connected");

			// 1. Generate ephemeral private key
			const privateKey = generatePrivateKey();

			// 2. Create session key object linked to user's wallet
			const sessionKey = SessionKey.fromSecp256k1({
				privateKey,
				root: address as `0x${string}`,
				chain: calibration,
			});

			// 3. Register on-chain — user signs tx in MetaMask to authorize
			//    this session key to use their filecoin-pay balance
			setStatus("Waiting for wallet approval...");
			const walletClient = await getWalletClient();

			const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60); // 7 days

			await SessionKey.loginSync(walletClient, {
				address: sessionKey.address,
				origin: "wtfoc",
				expiresAt,
				onHash(hash) {
					setStatus(`Waiting for tx ${hash.slice(0, 10)}... to be mined`);
				},
			});

			// 4. Send the private key to our server for encrypted storage
			setStatus("Saving session key to server...");
			const expiresAtIso = new Date(Number(expiresAt) * 1000).toISOString();
			const result = await delegateSessionKey(privateKey, expiresAtIso, calibration.id);

			sessionKeyActive.value = result.sessionKeyActive;
			sessionKeyExpiresAt.value = result.sessionKeyExpiresAt;
			setStatus(null);
		} catch (err) {
			const rpcErr = err as { code?: number; message?: string };
			if (rpcErr.code === 4001 || rpcErr.message?.toLowerCase().includes("user rejected")) {
				setError("Transaction cancelled");
			} else {
				setError(err instanceof Error ? err.message : (rpcErr.message ?? String(err)));
			}
			setStatus(null);
		} finally {
			setLoading(false);
		}
	};

	const handleRevoke = async () => {
		setError(null);
		setStatus(null);
		setLoading(true);
		try {
			const SessionKey = await import("@filoz/synapse-core/session-key");

			const address = walletAddress.value;
			if (!address) throw new Error("Wallet not connected");

			setStatus("Revoking session key...");
			const walletClient = await getWalletClient();

			// Revoke on-chain — need the session key's address
			// The server stores the encrypted private key; derive the address from it
			const serverResult = await revokeSessionKey();

			// If server had a session key address, revoke on-chain too
			if (serverResult.sessionKeyAddress) {
				await SessionKey.revokeSync(walletClient, {
					address: serverResult.sessionKeyAddress as `0x${string}`,
					origin: "wtfoc",
					onHash(hash) {
						setStatus(`Waiting for tx ${hash.slice(0, 10)}... to be mined`);
					},
				});
			}

			sessionKeyActive.value = false;
			sessionKeyExpiresAt.value = null;
			setStatus(null);
		} catch (err) {
			const rpcErr = err as { code?: number; message?: string };
			if (rpcErr.code === 4001 || rpcErr.message?.toLowerCase().includes("user rejected")) {
				setError("Transaction cancelled");
			} else {
				setError(err instanceof Error ? err.message : (rpcErr.message ?? String(err)));
			}
			setStatus(null);
		} finally {
			setLoading(false);
		}
	};

	if (sessionKeyActive.value) {
		return (
			<div class="session-key-manager">
				<span class="session-key-status active">Session key active</span>
				{sessionKeyExpiresAt.value && (
					<span class="session-key-expires">
						Expires: {new Date(sessionKeyExpiresAt.value).toLocaleString()}
					</span>
				)}
				<button type="button" onClick={handleRevoke} disabled={loading}>
					{loading ? "Revoking..." : "Revoke Key"}
				</button>
				{status && <span class="session-key-status-msg">{status}</span>}
				{error && <span class="session-key-error">{error}</span>}
			</div>
		);
	}

	return (
		<div class="session-key-manager">
			<span class="session-key-status inactive">No session key</span>
			<p>
				A session key authorizes the server to promote collections to FOC using your wallet's
				filecoin-pay balance. This requires an on-chain transaction.
			</p>
			<button type="button" onClick={handleDelegate} disabled={loading}>
				{loading ? "Delegating..." : "Delegate Session Key"}
			</button>
			{status && <span class="session-key-status-msg">{status}</span>}
			{error && <span class="session-key-error">{error}</span>}
		</div>
	);
}

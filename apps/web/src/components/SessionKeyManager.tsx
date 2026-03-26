import { useState } from "preact/hooks";
import { delegateSessionKey, revokeSessionKey } from "../api.js";
import { sessionKeyActive, sessionKeyExpiresAt } from "../state.js";
import { CALIBRATION_CHAIN_ID } from "../wallet.js";

export function SessionKeyManager() {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleDelegate = async () => {
		setError(null);
		setLoading(true);
		try {
			// Generate an ephemeral key pair client-side
			const { generatePrivateKey } = await import("viem/accounts");
			const sessionKey = generatePrivateKey();
			const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

			const result = await delegateSessionKey(sessionKey, expiresAt, CALIBRATION_CHAIN_ID);
			sessionKeyActive.value = result.sessionKeyActive;
			sessionKeyExpiresAt.value = result.sessionKeyExpiresAt;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	const handleRevoke = async () => {
		setError(null);
		setLoading(true);
		try {
			const result = await revokeSessionKey();
			sessionKeyActive.value = result.sessionKeyActive;
			sessionKeyExpiresAt.value = null;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
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
				{error && <span class="session-key-error">{error}</span>}
			</div>
		);
	}

	return (
		<div class="session-key-manager">
			<span class="session-key-status inactive">No session key</span>
			<p>A session key lets the server promote collections to FOC on your behalf.</p>
			<button type="button" onClick={handleDelegate} disabled={loading}>
				{loading ? "Delegating..." : "Delegate Session Key"}
			</button>
			{error && <span class="session-key-error">{error}</span>}
		</div>
	);
}

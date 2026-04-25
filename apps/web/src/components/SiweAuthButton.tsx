/**
 * SIWE sign-in / link-wallet button. Same component is used on /login
 * (anonymous → creates a new wallet-only user, or signs into an existing
 * wallet-linked user) and on /account (authenticated → adds an
 * accounts(provider='siwe') row to the current user, linking the wallet).
 *
 * The link-vs-signin distinction is made server-side by Auth.js based on
 * whether a session cookie is present at the credentials callback; this
 * component only triggers the flow.
 */

import { useState } from "preact/hooks";
import { linkWalletToAccount, signInWithWallet } from "../siwe-auth.js";

interface Props {
	mode: "signin" | "link";
	onComplete?: () => void;
}

export function SiweAuthButton({ mode, onComplete }: Props) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onClick() {
		setError(null);
		setLoading(true);
		try {
			if (mode === "link") {
				await linkWalletToAccount();
			} else {
				await signInWithWallet();
			}
			onComplete?.();
		} catch (err) {
			const rpcErr = err as { code?: number; message?: string };
			if (rpcErr.code === 4001 || rpcErr.message?.toLowerCase().includes("user rejected")) {
				setError(mode === "link" ? "Linking cancelled" : "Sign-in cancelled");
			} else {
				setError(err instanceof Error ? err.message : String(err));
			}
		} finally {
			setLoading(false);
		}
	}

	return (
		<div class="siwe-auth">
			<button type="button" class="btn" disabled={loading} onClick={onClick}>
				{loading
					? "Waiting for wallet…"
					: mode === "link"
						? "Link a wallet"
						: "Sign in with wallet"}
			</button>
			{error && <p class="auth-error">{error}</p>}
		</div>
	);
}

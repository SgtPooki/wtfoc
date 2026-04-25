/**
 * Lists wallets currently linked to the signed-in user. Lets them unlink
 * any wallet (subject to server-side lockout protection — can't unlink
 * the last sign-in method on a wallet-only account).
 */

import { signal } from "@preact/signals";
import { fetchLinkedWallets, unlinkWallet } from "../siwe-auth.js";

const wallets = signal<string[] | null>(null);
const error = signal<string | null>(null);
const removing = signal<string | null>(null);

function shortAddress(addr: string): string {
	if (addr.length < 12) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export async function refreshLinkedWallets(): Promise<void> {
	error.value = null;
	try {
		wallets.value = await fetchLinkedWallets();
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	}
}

async function onRemove(wallet: string): Promise<void> {
	if (!confirm(`Unlink ${shortAddress(wallet)} from this account?`)) return;
	removing.value = wallet;
	error.value = null;
	try {
		await unlinkWallet(wallet);
		await refreshLinkedWallets();
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		removing.value = null;
	}
}

export function LinkedWalletsList() {
	if (wallets.value === null && !error.value) {
		void refreshLinkedWallets();
	}
	if (wallets.value === null) {
		return <p class="auth-muted">Loading linked wallets…</p>;
	}
	if (wallets.value.length === 0) {
		return <p class="auth-muted">No wallets linked yet.</p>;
	}
	return (
		<>
			{error.value && <p class="auth-error">{error.value}</p>}
			<ul class="linked-wallets">
				{wallets.value.map((w) => (
					<li key={w} class="linked-wallet-row">
						<code title={w}>{shortAddress(w)}</code>
						<button
							type="button"
							class="btn btn-small"
							disabled={removing.value === w}
							onClick={() => onRemove(w)}
						>
							{removing.value === w ? "Removing…" : "Unlink"}
						</button>
					</li>
				))}
			</ul>
		</>
	);
}

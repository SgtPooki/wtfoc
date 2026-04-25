/**
 * /account — shows the logged-in user + a Sign out button. Collection
 * ownership UI lands in a later pass; this is the minimum viable
 * authenticated surface so we can prove the round trip.
 */

import { isAdmin, session, signOut } from "../accounts.js";
import { navigate } from "../route.js";
import { isConnected, sessionKeyActive, sessionKeyExpiresAt, walletAddress } from "../state";
import { AdminUsersPanel } from "./AdminUsersPanel";

function shortAddress(addr: string): string {
	if (addr.length < 12) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function onSignOut() {
	await signOut();
	navigate("/");
}

export function AccountPage() {
	const s = session.value;
	if (s === undefined)
		return (
			<main class="auth-page">
				<p>Loading…</p>
			</main>
		);
	if (s === null) {
		return (
			<main class="auth-page">
				<h1>Not signed in</h1>
				<p>
					<a
						href="/login"
						class="btn btn-primary"
						onClick={(e) => {
							e.preventDefault();
							navigate("/login");
						}}
					>
						Sign in
					</a>
				</p>
			</main>
		);
	}

	return (
		<main class="auth-page">
			<a
				href="/"
				class="auth-back"
				onClick={(e) => {
					e.preventDefault();
					navigate("/");
				}}
			>
				← Back
			</a>
			<h1>Account</h1>
			<div class="account-info">
				<p>
					<strong>Email:</strong> {s.user.email ?? "—"}
				</p>
				{s.user.name && (
					<p>
						<strong>Name:</strong> {s.user.name}
					</p>
				)}
				<p>
					<strong>Role:</strong> {s.user.role}
				</p>
				<p class="auth-muted">User ID: {s.user.id}</p>
				<p class="auth-muted">Session expires: {new Date(s.expires).toLocaleString()}</p>
			</div>
			<div class="account-actions">
				<a
					href="/app"
					class="btn btn-primary"
					onClick={(e) => {
						e.preventDefault();
						navigate("/app");
					}}
				>
					Open app
				</a>
				<button type="button" class="btn" onClick={onSignOut}>
					Sign out of account
				</button>
			</div>

			<section class="connections">
				<h2>Connections</h2>
				<div class="connection-row">
					<div>
						<strong>Email magic link</strong>
						<p class="auth-muted">{s.user.email ?? "—"} · active</p>
					</div>
					<span class="connection-tag connection-active">Signed in</span>
				</div>
				<div class="connection-row">
					<div>
						<strong>Wallet for signing</strong>
						{isConnected.value && walletAddress.value ? (
							<p class="auth-muted">
								{shortAddress(walletAddress.value)} · session-key{" "}
								{sessionKeyActive.value
									? `active (expires ${sessionKeyExpiresAt.value ? new Date(sessionKeyExpiresAt.value).toLocaleString() : "?"})`
									: "not delegated"}
							</p>
						) : (
							<p class="auth-muted">No wallet connected for this browser</p>
						)}
						<p class="auth-muted">
							This wallet is used to sign Filecoin promote transactions; it is not yet linked to
							your account identity. Wallet-as-account-login is coming with unified sign-in.
						</p>
					</div>
				</div>
			</section>

			<p class="auth-muted">Collection ownership + sharing land in the next wtfoc release.</p>
			{isAdmin.value && <AdminUsersPanel />}
		</main>
	);
}

/**
 * /account — shows the logged-in user + a Sign out button. Collection
 * ownership UI lands in a later pass; this is the minimum viable
 * authenticated surface so we can prove the round trip.
 */

import { isAdmin, session, signOut } from "../accounts.js";
import { navigate } from "../route.js";
import { AdminUsersPanel } from "./AdminUsersPanel";

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
					Sign out
				</button>
			</div>
			<p class="auth-muted">Collection ownership + sharing land in the next wtfoc release.</p>
			{isAdmin.value && <AdminUsersPanel />}
		</main>
	);
}

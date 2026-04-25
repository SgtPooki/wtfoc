/**
 * Admin-only users panel — list users + change role. Rendered inside
 * /account when the signed-in user has role='admin'. Calls the
 * /api/accounts/admin/users endpoints which run requireAdmin server-side,
 * so this panel only needs to gate visibility, not enforce auth.
 */

import { signal } from "@preact/signals";
import { session, type UserRole } from "../accounts.js";

interface AdminUser {
	id: string;
	email: string | null;
	name: string | null;
	emailVerified: string | null;
	role: UserRole;
	createdAt: string;
	updatedAt: string;
}

const users = signal<AdminUser[] | null>(null);
const error = signal<string | null>(null);
const updating = signal<string | null>(null);

async function loadUsers(): Promise<void> {
	error.value = null;
	try {
		const res = await fetch("/api/accounts/admin/users", { credentials: "same-origin" });
		if (!res.ok) {
			throw new Error(`failed to load users: ${res.status}`);
		}
		const body = (await res.json()) as { users: AdminUser[] };
		users.value = body.users;
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	}
}

async function changeRole(id: string, role: UserRole): Promise<void> {
	updating.value = id;
	error.value = null;
	try {
		const res = await fetch(`/api/accounts/admin/users/${id}/role`, {
			method: "PATCH",
			credentials: "same-origin",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ role }),
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(body.error ?? `failed: ${res.status}`);
		}
		await loadUsers();
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		updating.value = null;
	}
}

export function AdminUsersPanel() {
	if (users.value === null && !error.value) {
		void loadUsers();
	}
	const me = session.value?.user.id;
	return (
		<section class="admin-users">
			<h2>All users</h2>
			{error.value && <p class="auth-error">{error.value}</p>}
			{users.value === null && !error.value && <p class="auth-muted">Loading…</p>}
			{users.value && users.value.length === 0 && <p class="auth-muted">No users.</p>}
			{users.value && users.value.length > 0 && (
				<table class="admin-users-table">
					<thead>
						<tr>
							<th>Email</th>
							<th>Role</th>
							<th>Created</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						{users.value.map((u) => {
							const isMe = u.id === me;
							const isBusy = updating.value === u.id;
							return (
								<tr key={u.id}>
									<td>
										{u.email ?? <span class="auth-muted">—</span>}
										{isMe && <span class="admin-self-tag"> (you)</span>}
									</td>
									<td>{u.role}</td>
									<td class="auth-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
									<td>
										{u.role === "user" ? (
											<button
												type="button"
												class="btn"
												disabled={isBusy}
												onClick={() => changeRole(u.id, "admin")}
											>
												Promote
											</button>
										) : (
											<button
												type="button"
												class="btn"
												disabled={isBusy || isMe}
												title={isMe ? "Cannot demote yourself" : undefined}
												onClick={() => changeRole(u.id, "user")}
											>
												Demote
											</button>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}
		</section>
	);
}

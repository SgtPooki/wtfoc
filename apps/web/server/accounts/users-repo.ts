/**
 * Direct user-table accessors for the admin surface. Auth.js owns reads/
 * writes during sign-in via @auth/pg-adapter; this module only exposes the
 * extra queries the admin UI needs (list users, change role). Keep this
 * narrow so the wallet-flow Repository interface stays unrelated to the
 * Auth.js identity model.
 */

import type pg from "pg";

export type UserRole = "user" | "admin";

export interface AdminUserRow {
	id: string;
	email: string | null;
	name: string | null;
	emailVerified: Date | null;
	role: UserRole;
	createdAt: Date;
	updatedAt: Date;
}

interface RawRow {
	id: string;
	email: string | null;
	name: string | null;
	emailVerified: string | Date | null;
	role: string;
	created_at: string | Date;
	updated_at: string | Date;
}

function mapRow(row: RawRow): AdminUserRow {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		emailVerified: row.emailVerified ? new Date(row.emailVerified) : null,
		role: row.role === "admin" ? "admin" : "user",
		createdAt: new Date(row.created_at),
		updatedAt: new Date(row.updated_at),
	};
}

export async function listUsers(pool: pg.Pool): Promise<AdminUserRow[]> {
	const result = await pool.query<RawRow>(
		`SELECT id, email, name, "emailVerified", role, created_at, updated_at
		   FROM users ORDER BY created_at DESC`,
	);
	return result.rows.map(mapRow);
}

export async function updateUserRole(
	pool: pg.Pool,
	id: string,
	role: UserRole,
): Promise<AdminUserRow | null> {
	const result = await pool.query<RawRow>(
		`UPDATE users SET role = $1, updated_at = now()
		   WHERE id = $2
		   RETURNING id, email, name, "emailVerified", role, created_at, updated_at`,
		[role, id],
	);
	return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function countAdmins(pool: pg.Pool): Promise<number> {
	const result = await pool.query<{ count: string }>(
		`SELECT count(*)::text AS count FROM users WHERE role = 'admin'`,
	);
	return Number(result.rows[0]?.count ?? "0");
}

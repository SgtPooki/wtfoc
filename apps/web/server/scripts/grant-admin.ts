#!/usr/bin/env -S node --import tsx
/**
 * One-shot bootstrap to grant platform admin to a user by email.
 *
 *   pnpm --filter @wtfoc/web grant-admin sgtpooki@gmail.com
 *
 * Idempotent: re-running on an already-admin user is a no-op. Safe to run
 * from kubectl exec on the wtfoc pod (DATABASE_URL already wired). Use
 * `--revoke` to demote back to 'user'.
 *
 * This is the only sanctioned bootstrap path — there is no env-allowlist
 * shortcut. Subsequent admin grants happen through the admin UI / API
 * once the bootstrap admin exists.
 */

import process from "node:process";
import pg from "pg";

interface Args {
	email: string;
	revoke: boolean;
}

function parseArgs(argv: string[]): Args | null {
	const positional: string[] = [];
	let revoke = false;
	for (const arg of argv) {
		if (arg === "--revoke") revoke = true;
		else if (arg.startsWith("--")) return null;
		else positional.push(arg);
	}
	const email = positional[0];
	if (!email) return null;
	return { email: email.toLowerCase().trim(), revoke };
}

function usage(): never {
	console.error("usage: grant-admin <email> [--revoke]");
	process.exit(2);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args) usage();

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.error("DATABASE_URL is not set");
		process.exit(1);
	}

	const newRole = args.revoke ? "user" : "admin";
	const pool = new pg.Pool({ connectionString: databaseUrl });
	try {
		const result = await pool.query<{ id: string; email: string; role: string }>(
			`UPDATE users SET role = $1, updated_at = now()
			 WHERE lower(email) = $2
			 RETURNING id, email, role`,
			[newRole, args.email],
		);
		if (result.rowCount === 0) {
			console.error(
				`No user found with email ${args.email}. They must sign up first, then re-run.`,
			);
			process.exit(1);
		}
		const row = result.rows[0];
		if (!row) {
			console.error("Update succeeded but no row returned (unexpected)");
			process.exit(1);
		}
		console.log(`✓ ${row.email} → role=${row.role} (id ${row.id})`);
	} finally {
		await pool.end();
	}
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});

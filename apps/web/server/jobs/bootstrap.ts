import pg from "pg";
import { InMemoryJobQueue } from "./in-memory.js";
import { PgBossJobQueue } from "./pg-boss.js";
import type { JobQueue } from "./queue.js";

/**
 * Build the appropriate JobQueue for the current environment (#168).
 *
 * - DATABASE_URL set → PgBossJobQueue (durable)
 * - Unset → InMemoryJobQueue (tests / local-only mode)
 *
 * Caller owns start()/stop() lifecycle. Returns the queue and a `dispose`
 * helper that also closes any connection pool this module created.
 */
export async function createJobQueue(
	databaseUrl?: string,
): Promise<{ queue: JobQueue; dispose: () => Promise<void> }> {
	const url = databaseUrl ?? process.env.DATABASE_URL;
	if (!url) {
		const queue = new InMemoryJobQueue();
		return {
			queue,
			dispose: async () => {
				await queue.stop();
			},
		};
	}
	const pool = new pg.Pool({ connectionString: url });
	const queue = new PgBossJobQueue({ connectionString: url, pool });
	return {
		queue,
		dispose: async () => {
			await queue.stop();
			await pool.end();
		},
	};
}

import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import type { Job as BossJob } from "pg-boss";
import * as v from "valibot";
import { JobCollectionBusyError } from "./in-memory.js";
import type { JobQueue } from "./queue.js";
import {
	type EnqueueJobInput,
	JOB_PAYLOAD_SCHEMAS,
	type JobHandler,
	type JobRecord,
	type JobStatus,
	type JobSummary,
	type JobType,
} from "./types.js";

/** Period between cancel-flag polls inside a running handler (ms). */
const CANCEL_POLL_INTERVAL_MS = 1000;

export interface PgBossJobQueueOptions {
	connectionString: string;
	pool: Pool;
	/**
	 * Max jobs executed concurrently by this worker. Maps to pg-boss team
	 * size per job type; the per-collection invariant is enforced
	 * separately via a partial unique index on `jobs`.
	 */
	globalConcurrency?: number;
}

/**
 * Durable JobQueue backed by pg-boss (#168). pg-boss owns execution + retry
 * + scheduling; this class owns user-facing state through the `jobs` table
 * so API reads never leak pg-boss schema. Cancellation is cooperative:
 * `DELETE /api/jobs/:id` flips `cancel_requested_at`, the in-process
 * handler's AbortController aborts, and the handler is responsible for
 * unwinding through any I/O it owns.
 */
export class PgBossJobQueue implements JobQueue {
	readonly #pool: Pool;
	readonly #boss: PgBoss;
	readonly #globalConcurrency: number;
	readonly #handlers = new Map<JobType, JobHandler<unknown>>();
	readonly #abortControllers = new Map<string, AbortController>();
	readonly #subscribers = new Map<string, Set<(snapshot: JobRecord) => void>>();
	#cancelPollTimer: NodeJS.Timeout | null = null;

	constructor(opts: PgBossJobQueueOptions) {
		this.#pool = opts.pool;
		this.#boss = new PgBoss(opts.connectionString);
		this.#globalConcurrency = opts.globalConcurrency ?? 5;
	}

	async start(): Promise<void> {
		await this.#boss.start();
		for (const [type, handler] of this.#handlers) {
			await this.#registerWithBoss(type, handler);
		}
		this.#cancelPollTimer = setInterval(
			() => this.#pollCancellations(),
			CANCEL_POLL_INTERVAL_MS,
		);
	}

	async stop(): Promise<void> {
		if (this.#cancelPollTimer) {
			clearInterval(this.#cancelPollTimer);
			this.#cancelPollTimer = null;
		}
		for (const ac of this.#abortControllers.values()) ac.abort();
		this.#abortControllers.clear();
		await this.#boss.stop({ graceful: true });
	}

	register<T>(type: JobType, handler: JobHandler<T>): void {
		this.#handlers.set(type, handler as JobHandler<unknown>);
	}

	async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
		const schema = JOB_PAYLOAD_SCHEMAS[input.type];
		if (!schema) throw new Error(`unknown job type: ${input.type}`);
		v.parse(schema, input.payload);

		if (input.parentJobId) {
			const parent = await this.#pool.query(
				"SELECT id FROM jobs WHERE id = $1 AND wallet_address = $2",
				[input.parentJobId, input.walletAddress],
			);
			if (parent.rowCount === 0) {
				throw new Error(`parent job not found: ${input.parentJobId}`);
			}
		}

		// Idempotency fast-path: if a row with this key already exists, return
		// it instead of racing the unique constraint. Saves the INSERT attempt
		// for the common repeat-enqueue-from-parent-retry case.
		if (input.idempotencyKey) {
			const existing = await this.#pool.query(
				"SELECT * FROM jobs WHERE idempotency_key = $1",
				[input.idempotencyKey],
			);
			if (existing.rows[0]) return mapRow(existing.rows[0]);
		}

		const id = randomUUID();
		const client = await this.#pool.connect();
		try {
			await client.query("BEGIN");
			try {
				// Insert first so the partial unique index on active root states
				// enforces the "one mutating job per collection" invariant. The
				// idempotency-key unique index deduplicates child enqueues.
				const inserted = await client.query(
					`INSERT INTO jobs (
						id, type, wallet_address, collection_id,
						status, current, total, parent_job_id, idempotency_key
					) VALUES ($1, $2, $3, $4, 'queued', 0, 0, $5, $6)
					RETURNING *`,
					[
						id,
						input.type,
						input.walletAddress,
						input.collectionId,
						input.parentJobId ?? null,
						input.idempotencyKey ?? null,
					],
				);
				const row = inserted.rows[0];
				const bossJobId = await this.#boss.send(input.type, { jobId: id, payload: input.payload });
				await client.query("UPDATE jobs SET boss_job_id = $1 WHERE id = $2", [bossJobId, id]);
				await client.query("COMMIT");
				const enqueued = { ...mapRow(row), bossJobId };
				queueMicrotask(() => {
					this.#emit(id).catch(() => {});
				});
				return enqueued;
			} catch (err) {
				await client.query("ROLLBACK");
				if (isUniqueViolation(err, "jobs_collection_active_unique")) {
					throw new JobCollectionBusyError(input.collectionId ?? "(unknown)");
				}
				if (isUniqueViolation(err, "jobs_idempotency_key_unique") && input.idempotencyKey) {
					// Race with a concurrent enqueue that landed first — return that one.
					const existing = await this.#pool.query(
						"SELECT * FROM jobs WHERE idempotency_key = $1",
						[input.idempotencyKey],
					);
					if (existing.rows[0]) return mapRow(existing.rows[0]);
				}
				throw err;
			}
		} finally {
			client.release();
		}
	}

	async get(id: string, walletAddress: string): Promise<JobRecord | null> {
		const res = await this.#pool.query(
			"SELECT * FROM jobs WHERE id = $1 AND wallet_address = $2",
			[id, walletAddress],
		);
		return res.rows[0] ? mapRow(res.rows[0]) : null;
	}

	async list(
		walletAddress: string,
		filter?: { collectionId?: string; status?: JobStatus | JobStatus[] },
	): Promise<JobSummary[]> {
		const where: string[] = ["wallet_address = $1"];
		const params: unknown[] = [walletAddress];
		if (filter?.collectionId) {
			params.push(filter.collectionId);
			where.push(`collection_id = $${params.length}`);
		}
		if (filter?.status) {
			const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
			params.push(statuses);
			where.push(`status = ANY($${params.length})`);
		}
		const res = await this.#pool.query(
			`SELECT id, boss_job_id, type, wallet_address, collection_id, status,
			        phase, current, total, cancel_requested_at, started_at,
			        finished_at, error_code, parent_job_id, idempotency_key,
			        created_at, updated_at
			   FROM jobs
			  WHERE ${where.join(" AND ")}
			  ORDER BY created_at DESC
			  LIMIT 200`,
			params,
		);
		return res.rows.map(mapSummaryRow);
	}

	async listChildren(
		parentId: string,
		walletAddress: string,
	): Promise<JobSummary[]> {
		const res = await this.#pool.query(
			`SELECT id, boss_job_id, type, wallet_address, collection_id, status,
			        phase, current, total, cancel_requested_at, started_at,
			        finished_at, error_code, parent_job_id, idempotency_key,
			        created_at, updated_at
			   FROM jobs
			  WHERE parent_job_id = $1 AND wallet_address = $2
			  ORDER BY created_at ASC
			  LIMIT 200`,
			[parentId, walletAddress],
		);
		return res.rows.map(mapSummaryRow);
	}

	async cancel(id: string, walletAddress: string): Promise<boolean> {
		const res = await this.#pool.query(
			`UPDATE jobs
			    SET cancel_requested_at = now(),
			        updated_at = now(),
			        status = CASE
			          WHEN status = 'queued' THEN 'cancelled'
			          ELSE status
			        END,
			        finished_at = CASE
			          WHEN status = 'queued' THEN now()
			          ELSE finished_at
			        END
			  WHERE id = $1
			    AND wallet_address = $2
			    AND status IN ('queued', 'running')
			  RETURNING id`,
			[id, walletAddress],
		);
		if (res.rowCount === 0) return false;
		const ac = this.#abortControllers.get(id);
		if (ac) ac.abort();
		await this.#emit(id);
		return true;
	}

	async subscribe(
		id: string,
		walletAddress: string,
		listener: (snapshot: JobRecord) => void,
	): Promise<() => void> {
		const existing = await this.get(id, walletAddress);
		if (!existing) return () => {};
		let bucket = this.#subscribers.get(id);
		if (!bucket) {
			bucket = new Set();
			this.#subscribers.set(id, bucket);
		}
		bucket.add(listener);
		return () => {
			const b = this.#subscribers.get(id);
			if (!b) return;
			b.delete(listener);
			if (b.size === 0) this.#subscribers.delete(id);
		};
	}

	async #emit(id: string): Promise<void> {
		const bucket = this.#subscribers.get(id);
		if (!bucket || bucket.size === 0) return;
		const res = await this.#pool.query("SELECT * FROM jobs WHERE id = $1", [id]);
		const row = res.rows[0];
		if (!row) return;
		const snapshot = mapRow(row);
		for (const listener of bucket) {
			try {
				listener(snapshot);
			} catch (err) {
				console.error("[pg-boss-queue] subscriber threw", err);
			}
		}
	}

	async #registerWithBoss(type: JobType, handler: JobHandler<unknown>): Promise<void> {
		// pg-boss v12: per-node parallel workers via localConcurrency, batch fetch
		// of 1 keeps job-by-job semantics (no batched commit across handlers).
		await this.#boss.work<BossEnvelope>(
			type,
			{ localConcurrency: this.#globalConcurrency, batchSize: 1 },
			async (jobs: BossJob<BossEnvelope>[]) => {
				for (const job of jobs) {
					await this.#runOne(type, handler, job.data);
				}
			},
		);
	}

	async #runOne(
		type: JobType,
		handler: JobHandler<unknown>,
		envelope: BossEnvelope,
	): Promise<void> {
		const { jobId, payload } = envelope;
		const schema = JOB_PAYLOAD_SCHEMAS[type];
		try {
			v.parse(schema, payload);
		} catch (err) {
			await this.#finalize(jobId, "failed", {
				errorCode: "INVALID_PAYLOAD",
				errorMessage: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		// Check if cancel was already requested before we started.
		const pre = await this.#pool.query(
			"SELECT cancel_requested_at, status FROM jobs WHERE id = $1",
			[jobId],
		);
		const preRow = pre.rows[0];
		if (!preRow || preRow.status !== "queued") {
			// Race with cancel or missing row — nothing to do.
			return;
		}

		const ac = new AbortController();
		this.#abortControllers.set(jobId, ac);
		if (preRow.cancel_requested_at) ac.abort();

		await this.#pool.query(
			"UPDATE jobs SET status = 'running', started_at = now(), updated_at = now() WHERE id = $1",
			[jobId],
		);
		await this.#emit(jobId);

		try {
			await handler(payload, {
				jobId,
				signal: ac.signal,
				reportProgress: async (update) => {
					const sets: string[] = ["updated_at = now()"];
					const params: unknown[] = [];
					const push = (col: string, val: unknown) => {
						params.push(val);
						sets.push(`${col} = $${params.length + 1}`);
					};
					if (update.phase !== undefined) push("phase", update.phase);
					if (update.current !== undefined) push("current", update.current);
					if (update.total !== undefined) push("total", update.total);
					if (update.message !== undefined) push("message", update.message);
					if (params.length === 0) return;
					params.unshift(jobId);
					await this.#pool.query(`UPDATE jobs SET ${sets.join(", ")} WHERE id = $1`, params);
					await this.#emit(jobId);
				},
				enqueueChild: async (type, childPayload, opts) => {
					// Read current parent's wallet/collection lazily so we stay
					// correct even if future parent-rewrites shift them.
					const parentRow = await this.#pool.query(
						"SELECT wallet_address, collection_id FROM jobs WHERE id = $1",
						[jobId],
					);
					const parent = parentRow.rows[0];
					if (!parent) throw new Error(`parent row missing for job ${jobId}`);
					return this.enqueue({
						type,
						walletAddress: parent.wallet_address,
						collectionId:
							opts?.collectionId !== undefined ? opts.collectionId : parent.collection_id,
						payload: childPayload,
						parentJobId: jobId,
						idempotencyKey: opts?.idempotencyKey,
					});
				},
			});
			if (ac.signal.aborted) {
				await this.#finalize(jobId, "cancelled", null);
			} else {
				await this.#finalize(jobId, "succeeded", null);
			}
		} catch (err) {
			if (ac.signal.aborted) {
				await this.#finalize(jobId, "cancelled", null);
			} else {
				await this.#finalize(jobId, "failed", {
					errorCode: err instanceof Error ? err.name : "ERROR",
					errorMessage: err instanceof Error ? err.message : String(err),
				});
			}
		} finally {
			this.#abortControllers.delete(jobId);
		}
	}

	async #finalize(
		jobId: string,
		status: JobStatus,
		error: { errorCode: string; errorMessage: string } | null,
	): Promise<void> {
		await this.#pool.query(
			`UPDATE jobs
			    SET status = $2,
			        finished_at = now(),
			        updated_at = now(),
			        error_code = $3,
			        error_message = $4
			  WHERE id = $1`,
			[jobId, status, error?.errorCode ?? null, error?.errorMessage ?? null],
		);
		await this.#emit(jobId);
	}

	/**
	 * Wake up in-process handlers whose job row had cancel_requested_at flipped
	 * since we last polled. Postgres LISTEN/NOTIFY would be fancier but this
	 * is simpler and bounded by the handlers currently running in this node.
	 */
	async #pollCancellations(): Promise<void> {
		if (this.#abortControllers.size === 0) return;
		const ids = [...this.#abortControllers.keys()];
		try {
			const res = await this.#pool.query(
				`SELECT id FROM jobs
				  WHERE id = ANY($1)
				    AND cancel_requested_at IS NOT NULL`,
				[ids],
			);
			for (const row of res.rows) {
				const ac = this.#abortControllers.get(row.id);
				if (ac && !ac.signal.aborted) ac.abort();
			}
		} catch (err) {
			console.error("[pg-boss-queue] cancel poll error", err);
		}
	}
}

interface BossEnvelope {
	jobId: string;
	payload: unknown;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
	if (!err || typeof err !== "object") return false;
	const e = err as { code?: string; constraint?: string };
	return e.code === "23505" && e.constraint === constraint;
}

interface JobRow {
	id: string;
	boss_job_id: string | null;
	type: string;
	wallet_address: string;
	collection_id: string | null;
	status: string;
	phase: string | null;
	current: number;
	total: number;
	message: string | null;
	cancel_requested_at: Date | null;
	started_at: Date | null;
	finished_at: Date | null;
	error_code: string | null;
	error_message: string | null;
	parent_job_id: string | null;
	idempotency_key: string | null;
	created_at: Date;
	updated_at: Date;
}

function mapRow(row: JobRow): JobRecord {
	return {
		id: row.id,
		bossJobId: row.boss_job_id,
		type: row.type as JobType,
		walletAddress: row.wallet_address,
		collectionId: row.collection_id,
		status: row.status as JobStatus,
		phase: row.phase,
		current: Number(row.current),
		total: Number(row.total),
		message: row.message,
		cancelRequestedAt: row.cancel_requested_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		errorCode: row.error_code,
		errorMessage: row.error_message,
		parentJobId: row.parent_job_id,
		idempotencyKey: row.idempotency_key,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function mapSummaryRow(row: Omit<JobRow, "message" | "error_message">): JobSummary {
	return {
		id: row.id,
		bossJobId: row.boss_job_id,
		type: row.type as JobType,
		walletAddress: row.wallet_address,
		collectionId: row.collection_id,
		status: row.status as JobStatus,
		phase: row.phase,
		current: Number(row.current),
		total: Number(row.total),
		cancelRequestedAt: row.cancel_requested_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		errorCode: row.error_code,
		parentJobId: row.parent_job_id,
		idempotencyKey: row.idempotency_key,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

import { randomUUID } from "node:crypto";
import * as v from "valibot";
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

/**
 * In-memory JobQueue for tests (#168). Mirrors the real behaviour of
 * `PgBossJobQueue` closely enough that tests covering the route layer and
 * the ingest handler can run without postgres:
 *
 * - enqueue → new JobRecord with status=queued, then dispatch runs inline
 *   on next tick so tests can `await queue.enqueue(...)` then assert
 *   eventual state without sleeping
 * - enforces the "one mutating job per collection" invariant
 * - cooperative cancel via AbortController per in-flight handler
 * - payload validation uses the same valibot schemas as the real queue
 */
export class InMemoryJobQueue implements JobQueue {
	readonly #jobs = new Map<string, JobRecord>();
	readonly #handlers = new Map<JobType, JobHandler<unknown>>();
	readonly #abortControllers = new Map<string, AbortController>();
	readonly #subscribers = new Map<string, Set<(snapshot: JobRecord) => void>>();
	#started = false;

	async start(): Promise<void> {
		this.#started = true;
	}

	async stop(): Promise<void> {
		this.#started = false;
		for (const ac of this.#abortControllers.values()) ac.abort();
		this.#abortControllers.clear();
	}

	register<T>(type: JobType, handler: JobHandler<T>): void {
		this.#handlers.set(type, handler as JobHandler<unknown>);
	}

	async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
		const schema = JOB_PAYLOAD_SCHEMAS[input.type];
		if (!schema) {
			throw new Error(`unknown job type: ${input.type}`);
		}
		v.parse(schema, input.payload);

		if (input.collectionId && this.#hasActiveForCollection(input.collectionId)) {
			throw new JobCollectionBusyError(input.collectionId);
		}

		const now = new Date();
		const job: JobRecord = {
			id: randomUUID(),
			bossJobId: null,
			type: input.type,
			walletAddress: input.walletAddress,
			collectionId: input.collectionId,
			status: "queued",
			phase: null,
			current: 0,
			total: 0,
			message: null,
			cancelRequestedAt: null,
			startedAt: null,
			finishedAt: null,
			errorCode: null,
			errorMessage: null,
			parentJobId: input.parentJobId ?? null,
			createdAt: now,
			updatedAt: now,
		};
		this.#jobs.set(job.id, job);
		this.#emit(job.id);

		if (this.#started) {
			// Schedule handler on next tick; enqueue returns the queued record.
			queueMicrotask(() => {
				this.#dispatch(job.id, input.payload).catch((err) => {
					console.error("[in-memory-queue] dispatch error", err);
				});
			});
		}
		return { ...job };
	}

	async get(id: string, walletAddress: string): Promise<JobRecord | null> {
		const job = this.#jobs.get(id);
		if (!job) return null;
		if (job.walletAddress !== walletAddress) return null;
		return { ...job };
	}

	async list(
		walletAddress: string,
		filter?: { collectionId?: string; status?: JobStatus | JobStatus[] },
	): Promise<JobSummary[]> {
		const want = filter?.status
			? new Set(Array.isArray(filter.status) ? filter.status : [filter.status])
			: null;
		const out: JobSummary[] = [];
		for (const job of this.#jobs.values()) {
			if (job.walletAddress !== walletAddress) continue;
			if (filter?.collectionId && job.collectionId !== filter.collectionId) continue;
			if (want && !want.has(job.status)) continue;
			const { message: _msg, errorMessage: _err, ...summary } = job;
			out.push(summary);
		}
		return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	}

	async cancel(id: string, walletAddress: string): Promise<boolean> {
		const job = this.#jobs.get(id);
		if (!job || job.walletAddress !== walletAddress) return false;
		if (job.status !== "queued" && job.status !== "running") return false;
		job.cancelRequestedAt = new Date();
		job.updatedAt = new Date();
		const ac = this.#abortControllers.get(id);
		if (ac) ac.abort();
		// If still queued (handler not yet running), finalize immediately.
		if (job.status === "queued") {
			job.status = "cancelled";
			job.finishedAt = new Date();
		}
		this.#emit(id);
		return true;
	}

	async subscribe(
		id: string,
		walletAddress: string,
		listener: (snapshot: JobRecord) => void,
	): Promise<() => void> {
		const job = this.#jobs.get(id);
		if (!job || job.walletAddress !== walletAddress) {
			// Unknown / wallet-scoped miss — return a no-op unsubscribe so
			// callers don't need to special-case; they'll get no events.
			return () => {};
		}
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

	#emit(id: string): void {
		const job = this.#jobs.get(id);
		if (!job) return;
		const bucket = this.#subscribers.get(id);
		if (!bucket || bucket.size === 0) return;
		const snapshot = { ...job };
		for (const listener of bucket) {
			try {
				listener(snapshot);
			} catch (err) {
				console.error("[in-memory-queue] subscriber threw", err);
			}
		}
	}

	#hasActiveForCollection(collectionId: string): boolean {
		for (const job of this.#jobs.values()) {
			if (job.collectionId !== collectionId) continue;
			if (job.status === "queued" || job.status === "running") return true;
		}
		return false;
	}

	async #dispatch(id: string, payload: unknown): Promise<void> {
		const job = this.#jobs.get(id);
		if (!job) return;
		if (job.status !== "queued") return;
		const handler = this.#handlers.get(job.type);
		if (!handler) {
			job.status = "failed";
			job.errorCode = "NO_HANDLER";
			job.errorMessage = `no handler registered for job type ${job.type}`;
			job.finishedAt = new Date();
			job.updatedAt = new Date();
			return;
		}

		const ac = new AbortController();
		this.#abortControllers.set(id, ac);
		if (job.cancelRequestedAt) ac.abort();

		job.status = "running";
		job.startedAt = new Date();
		job.updatedAt = new Date();
		this.#emit(id);

		try {
			await handler(payload, {
				jobId: id,
				signal: ac.signal,
				reportProgress: async (update) => {
					if (update.phase !== undefined) job.phase = update.phase;
					if (update.current !== undefined) job.current = update.current;
					if (update.total !== undefined) job.total = update.total;
					if (update.message !== undefined) job.message = update.message;
					job.updatedAt = new Date();
					this.#emit(id);
				},
			});
			if (ac.signal.aborted) {
				job.status = "cancelled";
			} else {
				job.status = "succeeded";
			}
		} catch (err) {
			if (ac.signal.aborted) {
				job.status = "cancelled";
			} else {
				job.status = "failed";
				job.errorCode = err instanceof Error ? err.name : "ERROR";
				job.errorMessage = err instanceof Error ? err.message : String(err);
			}
		} finally {
			job.finishedAt = new Date();
			job.updatedAt = new Date();
			this.#abortControllers.delete(id);
			this.#emit(id);
		}
	}
}

/**
 * Thrown when the "one active mutating job per collection" invariant would
 * be violated. Callers should surface as HTTP 409 Conflict.
 */
export class JobCollectionBusyError extends Error {
	readonly collectionId: string;
	constructor(collectionId: string) {
		super(`collection ${collectionId} already has an active mutating job`);
		this.name = "JobCollectionBusyError";
		this.collectionId = collectionId;
	}
}

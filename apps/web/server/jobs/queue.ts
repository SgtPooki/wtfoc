import type {
	EnqueueJobInput,
	JobHandler,
	JobRecord,
	JobStatus,
	JobSummary,
	JobType,
} from "./types.js";

/**
 * App-local queue abstraction (#168). Wraps a durable backend (pg-boss) but
 * keeps user-facing reads served from our own `jobs` table so the API
 * contract doesn't leak pg-boss schema. Two implementations live in-tree:
 * `PgBossJobQueue` for production and `InMemoryJobQueue` for unit tests.
 *
 * Handlers are registered once at startup. Enqueues validate payloads with
 * valibot before writing the job row; the handler runs on whatever worker
 * picks up the pg-boss message.
 */
export interface JobQueue {
	/** Start the underlying backend (connect pg-boss, begin polling). */
	start(): Promise<void>;
	/** Drain in-flight handlers and disconnect the backend. */
	stop(): Promise<void>;

	/** Register a handler for a job type. Called before `start()`. */
	register<T>(type: JobType, handler: JobHandler<T>): void;

	/**
	 * Enqueue a job. Returns the app-owned job id (NOT the pg-boss id).
	 * Rejects if the payload fails its registered valibot schema, or if the
	 * per-collection "one mutating job" invariant would be violated.
	 */
	enqueue(input: EnqueueJobInput): Promise<JobRecord>;

	/** Read a single job, wallet-scoped. Returns null when not visible to the caller. */
	get(id: string, walletAddress: string): Promise<JobRecord | null>;

	/**
	 * List jobs for a wallet, newest first. Optional status + collection
	 * filters. Summary rows strip `message` + `errorMessage` to keep list
	 * payloads bounded.
	 */
	list(
		walletAddress: string,
		filter?: { collectionId?: string; status?: JobStatus | JobStatus[] },
	): Promise<JobSummary[]>;

	/**
	 * Request cancellation. Sets `cancel_requested_at` and aborts the
	 * in-process handler's AbortController. Cooperative — the handler has to
	 * check its signal and unwind. Returns true when the job was in a
	 * cancellable state, false otherwise (already terminal).
	 */
	cancel(id: string, walletAddress: string): Promise<boolean>;

	/**
	 * Subscribe to full-snapshot state changes for a single job (#288
	 * Phase 2 Slice B). The listener is invoked after every state mutation
	 * produced by this node — progress tick, cancel request, terminal
	 * transition. Returns an unsubscribe function. Does not poll: cross-node
	 * updates rely on the client's poll fallback when SSE goes silent.
	 */
	subscribe(
		id: string,
		walletAddress: string,
		listener: (snapshot: JobRecord) => void,
	): Promise<() => void>;
}

import * as v from "valibot";

/**
 * Allowlisted job types. Adding a new type MUST go through this union plus the
 * `JobPayloadSchemas` registry so cross-process payloads always round-trip
 * through runtime validation (#168).
 */
export const JOB_TYPES = ["ingest", "extract-edges", "materialize", "cid-pull"] as const;
export type JobType = (typeof JOB_TYPES)[number];

/**
 * Lifecycle of a persisted `jobs` row — the app's user-facing state.
 * `queued` and `running` are the only states that occupy the per-collection
 * "one mutating job" slot; `succeeded`/`failed`/`cancelled` free it.
 */
export const JOB_STATUSES = [
	"queued",
	"running",
	"succeeded",
	"failed",
	"cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Payload schemas per job type. Handlers MUST validate against these on
 * receipt; the router MUST validate before enqueue. Keeps the durable
 * cross-process boundary honest even when producer and consumer live in the
 * same monorepo today.
 */
export const ingestPayloadSchema = v.object({
	collectionId: v.string(),
});
export type IngestPayload = v.InferOutput<typeof ingestPayloadSchema>;

export const extractEdgesPayloadSchema = v.object({
	collectionName: v.string(),
	extractors: v.optional(v.array(v.string())),
});
export type ExtractEdgesPayload = v.InferOutput<typeof extractEdgesPayloadSchema>;

export const materializePayloadSchema = v.object({
	collectionName: v.string(),
});
export type MaterializePayload = v.InferOutput<typeof materializePayloadSchema>;

export const cidPullPayloadSchema = v.object({
	collectionId: v.string(),
	manifestCid: v.string(),
	collectionName: v.string(),
});
export type CidPullPayload = v.InferOutput<typeof cidPullPayloadSchema>;

export const JOB_PAYLOAD_SCHEMAS: Record<
	JobType,
	v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>
> = {
	ingest: ingestPayloadSchema,
	"extract-edges": extractEdgesPayloadSchema,
	materialize: materializePayloadSchema,
	"cid-pull": cidPullPayloadSchema,
};

/**
 * The app-owned job record. pg-boss owns execution durability (`bossJobId`
 * is the handle into pg-boss's own storage); wtfoc owns everything
 * user-facing — wallet scoping, collection scoping, progress, cancellation
 * intent, parent linkage, error surfacing.
 */
export interface JobRecord {
	id: string;
	bossJobId: string | null;
	type: JobType;
	walletAddress: string;
	collectionId: string | null;
	status: JobStatus;
	/** Human-readable current phase, e.g. "embedding", "extracting edges". */
	phase: string | null;
	/** Progress numerator. May be 0 until the first `reportProgress` call. */
	current: number;
	/** Progress denominator. 0 when total is unknown. */
	total: number;
	message: string | null;
	/** User-requested cancel timestamp — handlers poll `signal` to honor it. */
	cancelRequestedAt: Date | null;
	startedAt: Date | null;
	finishedAt: Date | null;
	errorCode: string | null;
	errorMessage: string | null;
	parentJobId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Partial record returned from the job list endpoint — strips the fields
 * that would balloon list responses on collections with many jobs.
 */
export type JobSummary = Omit<JobRecord, "message" | "errorMessage">;

/** Input shape for enqueueing a new job. */
export interface EnqueueJobInput<T extends JobType = JobType> {
	type: T;
	walletAddress: string;
	collectionId: string | null;
	payload: unknown;
	parentJobId?: string;
}

/**
 * Runtime context passed to every job handler. Handlers MUST:
 * 1. Respect `signal` — abort on cancel and long-wait.
 * 2. Call `reportProgress` periodically so the UI can poll.
 */
export interface JobContext {
	jobId: string;
	signal: AbortSignal;
	reportProgress(update: {
		phase?: string;
		current?: number;
		total?: number;
		message?: string;
	}): Promise<void>;
}

/** Handler registered per job type. */
export type JobHandler<T> = (payload: T, ctx: JobContext) => Promise<void>;

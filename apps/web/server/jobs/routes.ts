import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.js";
import type { AppEnv } from "../hono-app.js";
import { JobCollectionBusyError } from "./in-memory.js";
import type { JobQueue } from "./queue.js";
import type { JobRecord, JobStatus, JobSummary, JobType } from "./types.js";
import { JOB_STATUSES, JOB_TYPES } from "./types.js";

/**
 * Job CRUD routes (#168). Read + cancel only — all creation happens through
 * domain endpoints (collection POST, CID pull, etc.) that return the job id
 * alongside their resource. Keeps the public surface small and avoids the
 * "anyone can enqueue anything" problem of a generic POST /api/jobs.
 */
export function jobRoutes(getQueue: () => JobQueue): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	app.use("*", requireAuth);

	app.get("/", async (c) => {
		const wallet = c.get("walletAddress");
		const collectionId = c.req.query("collection") ?? undefined;
		const statusParam = c.req.query("status");
		const status = parseStatusFilter(statusParam);
		if (status === "invalid") {
			return c.json({ error: "invalid status filter", code: "INVALID_STATUS" }, 400);
		}
		const list = await getQueue().list(wallet, {
			collectionId,
			status,
		});
		return c.json({ jobs: list.map(summaryToJson) });
	});

	app.get("/:id", async (c) => {
		const wallet = c.get("walletAddress");
		const id = c.req.param("id");
		const job = await getQueue().get(id, wallet);
		if (!job) {
			return c.json({ error: "not found", code: "NOT_FOUND" }, 404);
		}
		return c.json({ job: recordToJson(job) });
	});

	app.delete("/:id", async (c) => {
		const wallet = c.get("walletAddress");
		const id = c.req.param("id");
		const ok = await getQueue().cancel(id, wallet);
		if (!ok) {
			// Either not found / not owned / already terminal
			return c.json(
				{ error: "cannot cancel", code: "NOT_CANCELLABLE" },
				409,
			);
		}
		return c.body(null, 204);
	});

	app.onError((err, c) => {
		if (err instanceof JobCollectionBusyError) {
			return c.json(
				{ error: err.message, code: "COLLECTION_BUSY" },
				409,
			);
		}
		throw err;
	});

	return app;
}

function parseStatusFilter(raw: string | undefined): JobStatus | JobStatus[] | undefined | "invalid" {
	if (!raw) return undefined;
	const parts = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (parts.length === 0) return undefined;
	for (const p of parts) {
		if (!(JOB_STATUSES as readonly string[]).includes(p)) return "invalid";
	}
	return parts.length === 1 ? (parts[0] as JobStatus) : (parts as JobStatus[]);
}

// Separate from the internal type so we can stabilize the JSON wire format
// (Date → ISO string, snake_case kept) without leaking Date objects.
interface JobJson {
	id: string;
	type: JobType;
	collectionId: string | null;
	status: JobStatus;
	phase: string | null;
	current: number;
	total: number;
	message?: string | null;
	errorCode: string | null;
	errorMessage?: string | null;
	cancelRequestedAt: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	parentJobId: string | null;
	createdAt: string;
	updatedAt: string;
}

function recordToJson(job: JobRecord): JobJson {
	return {
		id: job.id,
		type: job.type,
		collectionId: job.collectionId,
		status: job.status,
		phase: job.phase,
		current: job.current,
		total: job.total,
		message: job.message,
		errorCode: job.errorCode,
		errorMessage: job.errorMessage,
		cancelRequestedAt: isoOrNull(job.cancelRequestedAt),
		startedAt: isoOrNull(job.startedAt),
		finishedAt: isoOrNull(job.finishedAt),
		parentJobId: job.parentJobId,
		createdAt: job.createdAt.toISOString(),
		updatedAt: job.updatedAt.toISOString(),
	};
}

function summaryToJson(job: JobSummary): Omit<JobJson, "message" | "errorMessage"> {
	return {
		id: job.id,
		type: job.type,
		collectionId: job.collectionId,
		status: job.status,
		phase: job.phase,
		current: job.current,
		total: job.total,
		errorCode: job.errorCode,
		cancelRequestedAt: isoOrNull(job.cancelRequestedAt),
		startedAt: isoOrNull(job.startedAt),
		finishedAt: isoOrNull(job.finishedAt),
		parentJobId: job.parentJobId,
		createdAt: job.createdAt.toISOString(),
		updatedAt: job.updatedAt.toISOString(),
	};
}

function isoOrNull(d: Date | null): string | null {
	return d ? d.toISOString() : null;
}

export { JOB_TYPES };

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireAuth } from "../auth/middleware.js";
import type { AppEnv } from "../hono-app.js";
import { JobCollectionBusyError } from "./in-memory.js";
import type { JobQueue } from "./queue.js";
import type { JobRecord, JobStatus, JobSummary, JobType } from "./types.js";
import { JOB_STATUSES, JOB_TYPES } from "./types.js";

/**
 * Heartbeat interval for SSE progress streams. The client uses twice this
 * value as its stale-timer threshold before falling back to polling, so the
 * ratio matters more than the absolute value.
 */
export const SSE_HEARTBEAT_MS = Number(process.env["WTFOC_JOBS_SSE_HEARTBEAT_MS"]) || 15_000;
const TERMINAL_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

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

	app.get("/:id/events", async (c) => {
		const wallet = c.get("walletAddress");
		const id = c.req.param("id");
		const queue = getQueue();

		// Verify visibility up-front so unauthorized callers get a proper 404
		// instead of an empty SSE stream. Cross-wallet reads always fail here.
		const snapshot = await queue.get(id, wallet);
		if (!snapshot) {
			return c.json({ error: "not found", code: "NOT_FOUND" }, 404);
		}

		return streamSSE(c, async (stream) => {
			let closed = false;

			const send = async (job: JobRecord) => {
				if (closed) return;
				try {
					await stream.writeSSE({
						event: "snapshot",
						data: JSON.stringify(recordToJson(job)),
					});
				} catch {
					closed = true;
				}
			};

			// Initial snapshot — covers mid-job reconnect + terminal replay.
			await send(snapshot);

			const unsubscribe = await queue.subscribe(id, wallet, (job) => {
				// Subscriber callback is sync; fire-and-forget the async write.
				send(job).catch(() => {});
				if (TERMINAL_STATUSES.includes(job.status)) {
					closed = true;
				}
			});

			// If the snapshot was already terminal on first read, close after
			// replay so the client's `onmessage` handler gets one event.
			if (TERMINAL_STATUSES.includes(snapshot.status)) {
				closed = true;
			}

			const heartbeat = setInterval(() => {
				if (closed) {
					clearInterval(heartbeat);
					return;
				}
				stream.writeSSE({ event: "ping", data: "" }).catch(() => {
					closed = true;
				});
			}, SSE_HEARTBEAT_MS);
			heartbeat.unref?.();

			stream.onAbort(() => {
				closed = true;
				clearInterval(heartbeat);
				unsubscribe();
			});

			// Hold the stream open until closed; once closed, writeSSE throws
			// and the while loop exits so the handler can resolve cleanly.
			while (!closed) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
			clearInterval(heartbeat);
			unsubscribe();
		});
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

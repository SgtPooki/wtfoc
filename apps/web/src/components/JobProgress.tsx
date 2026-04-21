import { useEffect, useMemo, useState } from "preact/hooks";
import { cancelJob, fetchJob, type JobView } from "../api";

const POLL_INTERVAL_MS = 1500;
/** If no SSE message (progress or heartbeat) for this long, fall back to polling. */
const SSE_STALE_MS = 30_000;
const TERMINAL: JobView["status"][] = ["succeeded", "failed", "cancelled"];

interface Props {
	jobId: string;
	onTerminal?: (job: JobView) => void;
}

/**
 * Stream job progress for a pipeline rooted at `jobId` (#288 Phase 2).
 *
 * - Streams via SSE (`/api/jobs/:id/events`), falls back to 1.5s polling
 *   on error or silence >30s. Full snapshots only — no diff reconciliation.
 * - When the tracked job terminates successfully, we fetch children from
 *   `GET /api/jobs/:id`. If a queued/running child exists (e.g. the
 *   `materialize` child spawned by `ingest`), the component swaps its
 *   tracked job to the child and keeps streaming. This lets the UI show
 *   one rolling progress bar across the whole ingest → materialize chain.
 * - `onTerminal` fires only when the pipeline as a whole is done (current
 *   job terminal + no active children).
 */
export function JobProgress({ jobId: rootJobId, onTerminal }: Props) {
	const [trackedJobId, setTrackedJobId] = useState(rootJobId);
	const [job, setJob] = useState<JobView | null>(null);
	const [phaseHistory, setPhaseHistory] = useState<
		Array<{ type: string; status: JobView["status"] }>
	>([]);
	const [error, setError] = useState<string | null>(null);
	const [cancelling, setCancelling] = useState(false);

	// Reset tracked job whenever the root changes (new enqueue).
	useEffect(() => {
		setTrackedJobId(rootJobId);
		setPhaseHistory([]);
		setJob(null);
		setError(null);
	}, [rootJobId]);

	useEffect(() => {
		let stopped = false;
		let pollTimer: ReturnType<typeof setTimeout> | null = null;
		let staleTimer: ReturnType<typeof setTimeout> | null = null;
		let source: EventSource | null = null;
		const ac = new AbortController();

		const followNextChildOrFinish = async (terminal: JobView) => {
			try {
				const { children } = await fetchJob(terminal.id, ac.signal);
				const nextActive = (children ?? []).find(
					(c) => c.status === "queued" || c.status === "running",
				);
				if (nextActive && !stopped) {
					setPhaseHistory((prev) => [...prev, { type: terminal.type, status: terminal.status }]);
					setTrackedJobId(nextActive.id);
					return;
				}
				stopped = true;
				cleanup();
				onTerminal?.(terminal);
			} catch (err) {
				if (ac.signal.aborted || stopped) return;
				// Fall through to treat as pipeline-terminal if we can't peek at children.
				stopped = true;
				cleanup();
				setError(err instanceof Error ? err.message : String(err));
				onTerminal?.(terminal);
			}
		};

		const handleSnapshot = (latest: JobView) => {
			if (stopped) return;
			setJob(latest);
			setError(null);
			if (!TERMINAL.includes(latest.status)) return;
			if (latest.status === "succeeded") {
				// Might have a child to follow (ingest → materialize).
				void followNextChildOrFinish(latest);
			} else {
				// failed / cancelled — pipeline stops here.
				stopped = true;
				cleanup();
				onTerminal?.(latest);
			}
		};

		const cleanup = () => {
			if (staleTimer) clearTimeout(staleTimer);
			if (pollTimer) clearTimeout(pollTimer);
			if (source) source.close();
			ac.abort();
		};

		const startPolling = () => {
			if (stopped) return;
			const tick = async () => {
				if (stopped) return;
				try {
					const { job: latest } = await fetchJob(trackedJobId, ac.signal);
					handleSnapshot(latest);
					if (!stopped) pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
				} catch (err) {
					if (ac.signal.aborted || stopped) return;
					setError(err instanceof Error ? err.message : String(err));
					pollTimer = setTimeout(tick, POLL_INTERVAL_MS * 2);
				}
			};
			tick();
		};

		const armStaleTimer = () => {
			if (staleTimer) clearTimeout(staleTimer);
			staleTimer = setTimeout(() => {
				if (stopped) return;
				console.warn("[JobProgress] SSE stale — falling back to poll");
				if (source) source.close();
				source = null;
				startPolling();
			}, SSE_STALE_MS);
		};

		try {
			source = new EventSource(`/api/jobs/${encodeURIComponent(trackedJobId)}/events`, {
				withCredentials: true,
			});
			source.addEventListener("snapshot", (evt) => {
				armStaleTimer();
				try {
					const parsed = JSON.parse((evt as MessageEvent).data) as JobView;
					handleSnapshot(parsed);
				} catch (err) {
					console.error("[JobProgress] failed to parse snapshot", err);
				}
			});
			source.addEventListener("ping", armStaleTimer);
			source.addEventListener("error", () => {
				if (stopped) return;
				if (source) source.close();
				source = null;
				startPolling();
			});
			armStaleTimer();
		} catch (err) {
			console.error("[JobProgress] EventSource failed", err);
			startPolling();
		}

		return () => {
			stopped = true;
			cleanup();
		};
	}, [trackedJobId, onTerminal]);

	const onCancel = async () => {
		setCancelling(true);
		try {
			// Cancelling the tracked (current) job stops the chain here.
			await cancelJob(trackedJobId);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setCancelling(false);
		}
	};

	const chainLabel = useMemo(() => {
		if (!job) return "";
		const prior = phaseHistory.map((p) => p.type).join(" → ");
		return prior ? `${prior} → ${job.type}` : job.type;
	}, [job, phaseHistory]);

	if (!job) {
		return <div class="job-progress job-progress--loading">loading job…</div>;
	}

	const pct = job.total > 0 ? Math.round((job.current / job.total) * 100) : null;
	const cancellable = !TERMINAL.includes(job.status) && !job.cancelRequestedAt;

	return (
		<div class={`job-progress job-progress--${job.status}`}>
			<div class="job-progress__header">
				<span class="job-progress__type">{chainLabel}</span>
				<span class="job-progress__status">{job.status}</span>
				{cancellable ? (
					<button type="button" disabled={cancelling} onClick={onCancel}>
						{cancelling ? "cancelling…" : "cancel"}
					</button>
				) : null}
			</div>
			{job.phase ? <div class="job-progress__phase">{job.phase}</div> : null}
			{pct !== null ? (
				<div class="job-progress__bar">
					<div class="job-progress__bar-fill" style={{ width: `${pct}%` }} />
					<span class="job-progress__bar-label">
						{job.current} / {job.total} ({pct}%)
					</span>
				</div>
			) : null}
			{job.message ? <div class="job-progress__message">{job.message}</div> : null}
			{job.errorMessage ? (
				<div class="job-progress__error">
					{job.errorCode ? `[${job.errorCode}] ` : ""}
					{job.errorMessage}
				</div>
			) : null}
			{error ? <div class="job-progress__error">poll error: {error}</div> : null}
		</div>
	);
}

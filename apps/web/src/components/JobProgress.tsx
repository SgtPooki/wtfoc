import { useEffect, useState } from "preact/hooks";
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
 * Stream job progress via SSE (`/api/jobs/:id/events`), falling back to a
 * 1.5s poll on error or silence >30s (#288 Phase 2 Slice B). The server
 * emits a full snapshot on every state transition, so the client never has
 * to reconcile diffs. Survives page refresh because the server persists
 * job state in postgres.
 */
export function JobProgress({ jobId, onTerminal }: Props) {
	const [job, setJob] = useState<JobView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [cancelling, setCancelling] = useState(false);

	useEffect(() => {
		let stopped = false;
		let pollTimer: ReturnType<typeof setTimeout> | null = null;
		let staleTimer: ReturnType<typeof setTimeout> | null = null;
		let source: EventSource | null = null;
		const ac = new AbortController();

		const handleSnapshot = (latest: JobView) => {
			if (stopped) return;
			setJob(latest);
			setError(null);
			if (TERMINAL.includes(latest.status)) {
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
					const { job: latest } = await fetchJob(jobId, ac.signal);
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
			source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`, {
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
				// Drop SSE and fall back to poll on any error.
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
	}, [jobId, onTerminal]);

	const onCancel = async () => {
		setCancelling(true);
		try {
			await cancelJob(jobId);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setCancelling(false);
		}
	};

	if (!job) {
		return <div class="job-progress job-progress--loading">loading job…</div>;
	}

	const pct = job.total > 0 ? Math.round((job.current / job.total) * 100) : null;
	const cancellable = !TERMINAL.includes(job.status) && !job.cancelRequestedAt;

	return (
		<div class={`job-progress job-progress--${job.status}`}>
			<div class="job-progress__header">
				<span class="job-progress__type">{job.type}</span>
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

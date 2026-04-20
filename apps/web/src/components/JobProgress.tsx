import { useEffect, useState } from "preact/hooks";
import { cancelJob, fetchJob, type JobView } from "../api";

const POLL_INTERVAL_MS = 1500;
const TERMINAL: JobView["status"][] = ["succeeded", "failed", "cancelled"];

interface Props {
	jobId: string;
	onTerminal?: (job: JobView) => void;
}

/**
 * Poll a job and render a small progress bar + cancel control (#168).
 * Stops polling on terminal status. Survives page refresh because the
 * server keeps job state in postgres — `fetchJob` returns the same view
 * on next mount.
 */
export function JobProgress({ jobId, onTerminal }: Props) {
	const [job, setJob] = useState<JobView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [cancelling, setCancelling] = useState(false);

	useEffect(() => {
		const ac = new AbortController();
		let timer: ReturnType<typeof setTimeout> | null = null;
		let stopped = false;

		const tick = async () => {
			try {
				const { job: latest } = await fetchJob(jobId, ac.signal);
				if (stopped) return;
				setJob(latest);
				setError(null);
				if (TERMINAL.includes(latest.status)) {
					onTerminal?.(latest);
					return;
				}
				timer = setTimeout(tick, POLL_INTERVAL_MS);
			} catch (err) {
				if (ac.signal.aborted || stopped) return;
				setError(err instanceof Error ? err.message : String(err));
				timer = setTimeout(tick, POLL_INTERVAL_MS * 2);
			}
		};
		tick();
		return () => {
			stopped = true;
			if (timer) clearTimeout(timer);
			ac.abort();
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

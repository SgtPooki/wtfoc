import { useEffect, useState } from "preact/hooks";
import { fetchPromoteStatus, promoteCollection } from "../api.js";
import { sessionKeyActive } from "../state.js";
import { SessionKeyManager } from "./SessionKeyManager.js";

interface PromoteButtonProps {
	collectionId: string;
	collectionStatus: string;
	manifestCid: string | null;
}

export function PromoteButton({ collectionId, collectionStatus, manifestCid }: PromoteButtonProps) {
	const [promoting, setPromoting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string>(collectionStatus);
	const [cid, setCid] = useState<string | null>(manifestCid);

	useEffect(() => {
		if (status !== "promoting") return;

		let cancelled = false;
		const poll = async () => {
			try {
				const result = await fetchPromoteStatus(collectionId);
				if (!cancelled) {
					setStatus(result.status);
					if (result.manifestCid) setCid(result.manifestCid);
					if (result.status === "promoting") {
						setTimeout(poll, 5000);
					}
				}
			} catch {
				// Retry on error
				if (!cancelled) setTimeout(poll, 10000);
			}
		};
		poll();
		return () => {
			cancelled = true;
		};
	}, [status, collectionId]);

	const handlePromote = async () => {
		setError(null);
		setPromoting(true);
		try {
			const result = await promoteCollection(collectionId);
			setStatus(result.status);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPromoting(false);
		}
	};

	if (status === "promoted" && cid) {
		return (
			<div class="promote-result">
				<span class="promote-success">Promoted to FOC</span>
				<span class="promote-cid" title={cid}>
					CID: {cid}
				</span>
			</div>
		);
	}

	if (status === "promoting") {
		return (
			<div class="promote-progress">
				<span>Promoting to FOC...</span>
			</div>
		);
	}

	if (status !== "ready" && status !== "promotion_failed") {
		return null;
	}

	if (!sessionKeyActive.value) {
		return (
			<div class="promote-needs-key">
				<p>A session key is required to promote to FOC.</p>
				<SessionKeyManager />
			</div>
		);
	}

	return (
		<div class="promote-action">
			<button type="button" onClick={handlePromote} disabled={promoting}>
				{promoting
					? "Starting..."
					: status === "promotion_failed"
						? "Retry Promote to FOC"
						: "Promote to FOC"}
			</button>
			{error && <span class="promote-error">{error}</span>}
		</div>
	);
}

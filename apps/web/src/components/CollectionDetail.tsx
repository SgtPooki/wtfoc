import { useEffect, useState } from "preact/hooks";
import { fetchCollectionDetail, type WalletCollectionDetail } from "../api.js";
import { PromoteButton } from "./PromoteButton.js";

const STATUS_COLORS: Record<string, string> = {
	pending: "#888",
	ingesting: "#f0ad4e",
	complete: "#5cb85c",
	failed: "#d9534f",
	ready: "#5cb85c",
	promoting: "#f0ad4e",
	promoted: "#337ab7",
	ingestion_failed: "#d9534f",
	promotion_failed: "#d9534f",
};

interface CollectionDetailProps {
	collectionId: string;
}

export function CollectionDetail({ collectionId }: CollectionDetailProps) {
	const [detail, setDetail] = useState<WalletCollectionDetail | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const poll = async () => {
			try {
				const data = await fetchCollectionDetail(collectionId);
				if (!cancelled) {
					setDetail(data);
					setError(null);

					// Continue polling if in a non-terminal state
					const status = data.status;
					if (status === "ingesting" || status === "promoting" || status === "creating") {
						timer = setTimeout(poll, 5000);
					}
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		};

		poll();

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [collectionId]);

	if (error) {
		return <div class="collection-detail-error">Error: {error}</div>;
	}

	if (!detail) {
		return <div class="collection-detail-loading">Loading...</div>;
	}

	return (
		<div class="collection-detail">
			<h3>{detail.name}</h3>
			<div class="collection-status">
				<span class="status-badge" style={{ color: STATUS_COLORS[detail.status] ?? "#888" }}>
					{detail.status}
				</span>
				{detail.manifestCid && (
					<span class="collection-cid" title={detail.manifestCid}>
						CID: {detail.manifestCid.slice(0, 16)}...
					</span>
				)}
			</div>

			<h4>Sources</h4>
			<ul class="source-list">
				{detail.sources.map((source) => (
					<li key={source.id} class="source-item">
						<span class="source-type">{source.type}</span>
						<span class="source-id">{source.identifier}</span>
						<span class="source-status" style={{ color: STATUS_COLORS[source.status] ?? "#888" }}>
							{source.status}
							{source.chunkCount !== null && ` (${source.chunkCount} chunks)`}
						</span>
						{source.error && <span class="source-error">{source.error}</span>}
					</li>
				))}
			</ul>

			<PromoteButton
				collectionId={detail.id}
				collectionStatus={detail.status}
				manifestCid={detail.manifestCid}
			/>

			<div class="collection-meta">
				<span>Created: {new Date(detail.createdAt).toLocaleString()}</span>
				<span>Updated: {new Date(detail.updatedAt).toLocaleString()}</span>
			</div>
		</div>
	);
}

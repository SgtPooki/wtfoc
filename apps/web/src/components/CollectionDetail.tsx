import { useEffect, useState } from "preact/hooks";
import {
	addSourcesToCollection,
	fetchCollectionDetail,
	type WalletCollectionDetail,
} from "../api.js";
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

function AddSourceForm({ collectionId, onAdded }: { collectionId: string; onAdded: () => void }) {
	const [type, setType] = useState("github");
	const [identifier, setIdentifier] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		if (!identifier.trim()) return;
		setError(null);
		setSubmitting(true);
		try {
			await addSourcesToCollection(collectionId, [{ type, identifier: identifier.trim() }]);
			setIdentifier("");
			onAdded();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form
			class="add-source-form source-row"
			onSubmit={handleSubmit}
			style={{ marginTop: "0.5rem" }}
		>
			<select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
				<option value="github">GitHub (owner/repo)</option>
				<option value="website">Website (HTTPS URL)</option>
				<option value="hackernews">HackerNews (thread ID)</option>
			</select>
			<input
				type="text"
				value={identifier}
				onInput={(e) => setIdentifier((e.target as HTMLInputElement).value)}
				placeholder={
					type === "github" ? "owner/repo" : type === "website" ? "https://..." : "thread ID"
				}
			/>
			<button type="submit" disabled={submitting}>
				{submitting ? "Adding..." : "+ Add"}
			</button>
			{error && <span class="form-error">{error}</span>}
		</form>
	);
}

export function CollectionDetail({ collectionId }: CollectionDetailProps) {
	const [detail, setDetail] = useState<WalletCollectionDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);

	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const poll = async () => {
			try {
				const data = await fetchCollectionDetail(collectionId);
				if (!cancelled) {
					setDetail(data);
					setError(null);

					// Continue polling if any source is still ingesting or collection is in progress
					const status = data.status;
					const anyIngesting = data.sources.some(
						(s) => s.status === "ingesting" || s.status === "pending",
					);
					if (
						status === "ingesting" ||
						status === "promoting" ||
						status === "creating" ||
						anyIngesting
					) {
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
	}, [collectionId, refreshKey]);

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

			{detail.status !== "promoting" && (
				<AddSourceForm collectionId={detail.id} onAdded={() => setRefreshKey((k) => k + 1)} />
			)}

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

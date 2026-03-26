import { useEffect, useState } from "preact/hooks";
import { fetchMyCollections, type WalletCollection } from "../api.js";
import { activeCollectionId, walletView } from "../state.js";

const STATUS_COLORS: Record<string, string> = {
	creating: "#888",
	ingesting: "#f0ad4e",
	ready: "#5cb85c",
	ingestion_failed: "#d9534f",
	promoting: "#f0ad4e",
	promoted: "#337ab7",
	promotion_failed: "#d9534f",
};

export function CollectionList() {
	const [collections, setCollections] = useState<WalletCollection[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const poll = async () => {
			try {
				const data = await fetchMyCollections();
				if (!cancelled) {
					setCollections(data.collections);
					setError(null);
					setLoading(false);
					timer = setTimeout(poll, 10000);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
					setLoading(false);
					timer = setTimeout(poll, 10000);
				}
			}
		};

		poll();

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, []);

	const handleClick = (id: string) => {
		activeCollectionId.value = id;
		walletView.value = "detail";
	};

	if (loading) {
		return <div class="collection-list-loading">Loading collections...</div>;
	}

	if (error) {
		return <div class="collection-list-error">Error: {error}</div>;
	}

	if (collections.length === 0) {
		return (
			<div class="collection-list-empty">
				<p>No collections yet. Create one to get started.</p>
			</div>
		);
	}

	return (
		<div class="collection-list">
			<h3>My Collections</h3>
			<table>
				<thead>
					<tr>
						<th>Name</th>
						<th>Status</th>
						<th>Sources</th>
						<th>Segments</th>
						<th>CID</th>
						<th>Created</th>
					</tr>
				</thead>
				<tbody>
					{collections.map((col) => (
						<tr
							key={col.id}
							class="collection-row"
							onClick={() => handleClick(col.id)}
							style={{ cursor: "pointer" }}
						>
							<td>{col.name}</td>
							<td>
								<span style={{ color: STATUS_COLORS[col.status] ?? "#888" }}>{col.status}</span>
							</td>
							<td>{col.sourceCount}</td>
							<td>{col.segmentCount ?? "-"}</td>
							<td>{col.manifestCid ? `${col.manifestCid.slice(0, 12)}...` : "-"}</td>
							<td>{new Date(col.createdAt).toLocaleDateString()}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

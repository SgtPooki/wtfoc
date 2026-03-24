import { useEffect, useState } from "preact/hooks";
import { fetchCollections } from "../api";
import { collection } from "../state";
import type { CollectionSummary } from "../types";
import { CidInput } from "./CidInput";
import { ErrorBanner } from "./ErrorBanner";

function timeAgo(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const hours = Math.floor(ms / 3600000);
	if (hours < 1) return "just now";
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return `${Math.floor(days / 30)}mo ago`;
}

export function CollectionPicker() {
	const [collections, setCollections] = useState<CollectionSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		fetchCollections()
			.then((cols) => {
				setCollections(cols);
				setLoaded(true);
				if (cols.length === 1 && cols[0]) {
					collection.value = cols[0].name;
				}
			})
			.catch((err) => {
				setError(err instanceof Error ? err.message : "Failed to load collections");
				setLoaded(true);
			});
	}, []);

	if (error) return <ErrorBanner message={error} />;
	if (!loaded)
		return (
			<div class="muted" style={{ padding: "2rem", textAlign: "center" }}>
				Loading collections...
			</div>
		);
	if (collections.length === 0)
		return (
			<div class="muted" style={{ padding: "2rem", textAlign: "center" }}>
				No collections found.
			</div>
		);

	return (
		<div>
			<h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Collections</h2>
			<p class="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
				Pick a collection — real chunks, real traces, stored on FOC.
			</p>
			<div class="collection-grid">
				{collections.map((c) => (
					<button
						key={c.name}
						type="button"
						class={`collection-card card-enter ${c.name === collection.value ? "active" : ""}`}
						onClick={() => {
							collection.value = c.name;
						}}
					>
						<h3>{c.name}</h3>
						<div class="collection-meta">
							<span>
								<strong>{(c.chunks / 1000).toFixed(1)}K</strong> chunks
							</span>
							<span>
								<strong>{c.segments}</strong> segments
							</span>
							<span>updated {timeAgo(c.updated)}</span>
						</div>
					</button>
				))}
			</div>
			<CidInput />
		</div>
	);
}

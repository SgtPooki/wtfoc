import { useCallback, useEffect, useState } from "preact/hooks";
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

function CollectionGrid({ collections }: { collections: CollectionSummary[] }) {
	return (
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
	);
}

function SkeletonGrid() {
	return (
		<div class="collection-grid">
			{[1, 2, 3].map((i) => (
				<div key={i} class="collection-card" style={{ cursor: "default" }}>
					<div class="skeleton" style={{ height: "1rem", width: "60%", marginBottom: "0.5rem" }} />
					<div style={{ display: "flex", gap: "1rem" }}>
						<div class="skeleton" style={{ height: "0.7rem", width: "30%" }} />
						<div class="skeleton" style={{ height: "0.7rem", width: "25%" }} />
						<div class="skeleton" style={{ height: "0.7rem", width: "20%" }} />
					</div>
				</div>
			))}
		</div>
	);
}

export function CollectionPicker() {
	const [collections, setCollections] = useState<CollectionSummary[]>([]);
	const [error] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);

	const loadCollections = useCallback(() => {
		fetchCollections()
			.then((cols) => {
				setCollections(cols);
				setLoaded(true);
				if (cols.length === 1 && cols[0]) {
					collection.value = cols[0].name;
				}
			})
			.catch(() => {
				setCollections([]);
				setLoaded(true);
			});
	}, []);

	useEffect(() => {
		loadCollections();
	}, [loadCollections]);

	return (
		<div>
			<CidInput onCollectionsChanged={loadCollections} />

			<h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem", marginTop: "2rem" }}>Collections</h2>
			<p class="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
				Pick a collection — real chunks, real traces, stored on FOC.
			</p>

			{error && <ErrorBanner message={error} />}
			{!loaded && <SkeletonGrid />}
			{loaded && collections.length === 0 && !error && (
				<p class="muted" style={{ textAlign: "center", padding: "1rem" }}>
					No collections found.
				</p>
			)}
			{loaded && collections.length > 0 && <CollectionGrid collections={collections} />}
		</div>
	);
}

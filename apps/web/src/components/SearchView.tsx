import { useEffect, useState } from "preact/hooks";
import { fetchQuery } from "../api";
import { activeQuery, collection, getAbortSignal, loading } from "../state";
import type { QueryResponse } from "../types";
import { EmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import { HopCard } from "./HopCard";
import { SkeletonResults } from "./Skeleton";

export function SearchView() {
	const [data, setData] = useState<QueryResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const query = activeQuery.value;
	const col = collection.value;

	useEffect(() => {
		if (!query || !col) {
			setData(null);
			setError(null);
			return;
		}

		loading.value = true;
		setError(null);
		const signal = getAbortSignal();

		fetchQuery(col, query, 10, signal)
			.then((result) => {
				setData(result);
				loading.value = false;
			})
			.catch((err) => {
				if ((err as Error).name === "AbortError") return;
				setError(err instanceof Error ? err.message : "Failed to search");
				loading.value = false;
			});
	}, [query, col]);

	if (!query) return <EmptyState />;
	if (loading.value && !data) return <SkeletonResults />;
	if (error) return <ErrorBanner message={error} onDismiss={() => setError(null)} />;
	if (!data || data.results.length === 0) {
		return <div class="results-header">No results found.</div>;
	}

	return (
		<div class="search-results">
			<div class="results-header">{data.results.length} results</div>
			{data.results.map((r, i) => (
				<HopCard
					key={`${r.entry.id}-${i}`}
					sourceType={r.entry.metadata.sourceType}
					source={r.entry.metadata.source}
					sourceUrl={r.entry.metadata.sourceUrl}
					content={r.entry.metadata.content}
					connection={{ method: "semantic", confidence: r.score }}
					score={r.score}
				/>
			))}
		</div>
	);
}

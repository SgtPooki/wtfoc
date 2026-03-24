import { useEffect, useState } from "preact/hooks";
import { fetchTrace } from "../api";
import { activeQuery, collection, getAbortSignal, loading } from "../state";
import type { TraceResponse } from "../types";
import { ConnectionGraph } from "./ConnectionGraph";
import { EmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import { HopCard } from "./HopCard";
import { SkeletonResults } from "./Skeleton";

export function TraceView() {
	const [data, setData] = useState<TraceResponse | null>(null);
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

		fetchTrace(col, query, signal)
			.then((result) => {
				setData(result);
				loading.value = false;
			})
			.catch((err) => {
				if ((err as Error).name === "AbortError") return;
				setError(err instanceof Error ? err.message : "Failed to trace query");
				loading.value = false;
			});
	}, [query, col]);

	if (!query) return <EmptyState />;
	if (loading.value && !data) return <SkeletonResults />;
	if (error) return <ErrorBanner message={error} onDismiss={() => setError(null)} />;
	if (!data) return null;

	const { stats, groups } = data;
	const groupEntries = Object.entries(groups);

	return (
		<div class="trace-results">
			<div class="results-header">
				{stats.totalHops} results across {stats.sourceTypes.length} source types ({stats.edgeHops}{" "}
				via edges, {stats.semanticHops} semantic)
			</div>

			<ConnectionGraph groups={groups} />

			{groupEntries.map(([sourceType, hops]) => (
				<div key={sourceType} class="group">
					<div class="group-header">
						<span class={`badge badge-${sourceType}`}>{sourceType.replace(/-/g, " ")}</span>
						<span class="group-count">{hops.length} results</span>
					</div>
					{hops.map((hop, i) => (
						<HopCard
							key={`${hop.source}-${i}`}
							sourceType={hop.sourceType}
							source={hop.source}
							sourceUrl={hop.sourceUrl}
							content={hop.content}
							connection={hop.connection}
						/>
					))}
				</div>
			))}
		</div>
	);
}

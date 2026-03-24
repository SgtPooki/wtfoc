import { useEffect, useState } from "preact/hooks";
import { fetchSources } from "../api";
import { collection } from "../state";
import type { SourcesResponse } from "../types";

export function SourcesPanel() {
	const [data, setData] = useState<SourcesResponse | null>(null);
	const [expanded, setExpanded] = useState(false);
	const col = collection.value;

	useEffect(() => {
		if (!col) return;
		fetchSources(col)
			.then(setData)
			.catch(() => {});
	}, [col]);

	if (!data) return null;

	const entries = Object.entries(data).sort((a, b) => b[1].count - a[1].count);
	const totalSources = entries.reduce((n, [, info]) => n + info.sources.length, 0);
	const totalChunks = entries.reduce((n, [, info]) => n + info.count, 0);

	return (
		<div class="sources-panel card-enter">
			<button
				type="button"
				class="sources-header"
				onClick={() => setExpanded(!expanded)}
			>
				<h3>Sources</h3>
				<span class="sources-summary">
					{totalSources} sources &middot; {totalChunks.toLocaleString()} chunks &middot;{" "}
					{entries.length} types
				</span>
				<span class="sources-toggle">{expanded ? "▾" : "▸"}</span>
			</button>
			{expanded && (
				<div class="sources-body">
					{entries.map(([sourceType, info]) => (
						<div key={sourceType} class="sources-group">
							<div class="sources-group-header">
								<span class={`badge badge-${sourceType}`}>
									{sourceType.replace(/-/g, " ")}
								</span>
								<span class="sources-count">
									{info.count.toLocaleString()} chunks from {info.sources.length} source
									{info.sources.length !== 1 ? "s" : ""}
								</span>
							</div>
							<div class="sources-list">
								{info.sources.map((source) => (
									<span key={source} class="source-chip">
										{source}
									</span>
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

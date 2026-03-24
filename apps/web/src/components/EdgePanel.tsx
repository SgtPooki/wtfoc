import { useEffect, useState } from "preact/hooks";
import { fetchEdges } from "../api";
import { collection } from "../state";
import type { EdgesResponse } from "../types";

export function EdgePanel() {
	const [data, setData] = useState<EdgesResponse | null>(null);
	const [expanded, setExpanded] = useState(false);
	const col = collection.value;

	useEffect(() => {
		if (!col) return;
		fetchEdges(col)
			.then(setData)
			.catch(() => {});
	}, [col]);

	if (!data) return null;

	const resolution = data.totalEdges > 0 ? data.resolution : 0;
	const unresolvedEntries = Object.entries(data.topUnresolved);

	return (
		<div class="edge-panel card-enter">
			<h3>Edge Coverage</h3>
			<div class="edge-bar">
				<div class="edge-bar-fill" style={{ width: `${resolution}%` }} />
			</div>
			<div class="edge-detail">
				{data.resolvedEdges.toLocaleString()} of {data.totalEdges.toLocaleString()} edges resolved (
				{resolution}%) &middot; {data.bareRefs} bare refs
			</div>
			{unresolvedEntries.length > 0 && (
				<div style={{ marginTop: "0.5rem" }}>
					<button
						type="button"
						class="example-chip"
						style={{ fontSize: "0.75rem" }}
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? "Hide" : "Show"} top unresolved ({unresolvedEntries.length})
					</button>
					{expanded && (
						<div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--muted)" }}>
							{unresolvedEntries.map(([ref, count]) => (
								<div key={ref}>
									{ref}: <strong style={{ color: "var(--text)" }}>{count}</strong>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

import { useState } from "preact/hooks";
import type { HopConnection } from "../types";

interface HopCardProps {
	sourceType: string;
	source: string;
	sourceUrl: string;
	content: string;
	connection: HopConnection;
	score?: number;
}

function connectionLabel(conn: HopConnection): string {
	if (conn.method === "edge") {
		return `${conn.edgeType ?? "edge"} (${Math.round(conn.confidence * 100)}%)`;
	}
	return `semantic (${Math.round(conn.confidence * 100)}%)`;
}

export function HopCard({
	sourceType,
	source,
	sourceUrl,
	content,
	connection,
	score,
}: HopCardProps) {
	const [expanded, setExpanded] = useState(false);
	const isCode = sourceType === "code";

	return (
		<div class="hop card-enter">
			<div class="hop-header">
				<span class={`badge badge-${sourceType}`}>{sourceType.replace(/-/g, " ")}</span>
				<span class="hop-source">
					{sourceUrl ? (
						<a href={sourceUrl} target="_blank" rel="noopener noreferrer">
							{source}
						</a>
					) : (
						source
					)}
				</span>
				<span class={`hop-connection ${connection.method}`}>{connectionLabel(connection)}</span>
				{score !== undefined && <span class="hop-score">{(score * 100).toFixed(0)}%</span>}
			</div>
			<button
				type="button"
				class={`hop-content ${expanded ? "expanded" : ""}`}
				onClick={() => setExpanded(!expanded)}
			>
				{isCode ? <pre>{content}</pre> : content}
			</button>
		</div>
	);
}

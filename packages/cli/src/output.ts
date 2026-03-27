import type { QueryResult, TraceResult } from "@wtfoc/search";

export type OutputFormat = "human" | "json" | "quiet";

/**
 * Format trace results for terminal output.
 */
export function formatTrace(result: TraceResult, format: OutputFormat): string {
	if (format === "json") return JSON.stringify(result, null, "\t");
	if (format === "quiet") return "";

	const lines: string[] = [];
	lines.push(`🔍 Trace: "${result.query}"\n`);

	const sourceIcons: Record<string, string> = {
		"slack-message": "📨",
		"discord-message": "💬",
		"github-issue": "📋",
		"github-pr": "🔀",
		"github-issue-comment": "💬",
		"github-pr-review": "👀",
		code: "📄",
		markdown: "📝",
		"doc-page": "🌐",
	};

	for (const [sourceType, hops] of Object.entries(result.groups)) {
		const icon = sourceIcons[sourceType] ?? "📎";
		lines.push(`${icon} ${sourceType} (${hops.length} matches)`);

		for (const hop of hops) {
			const snippet = hop.content.slice(0, 120).replace(/\n/g, " ");
			const score = hop.connection.confidence.toFixed(2);
			lines.push(`  [${score}] ${hop.source}`);
			lines.push(`         ${snippet}${hop.content.length > 120 ? "..." : ""}`);

			if (hop.connection.method === "edge") {
				lines.push(`         🔗 ${hop.connection.edgeType}: ${hop.connection.evidence ?? ""}`);
			}

			if (hop.sourceUrl) {
				lines.push(`         ${hop.sourceUrl}`);
			}

			lines.push(`         ID: ${hop.storageId}`);
			lines.push("");
		}
	}

	// Show cross-source insights (analytical mode)
	if (result.insights && result.insights.length > 0) {
		lines.push("─── Cross-Source Insights ───\n");

		const insightIcons: Record<string, string> = {
			convergence: "🔄",
			"evidence-chain": "🔗",
			"temporal-cluster": "📅",
		};

		for (const insight of result.insights) {
			const icon = insightIcons[insight.kind] ?? "💡";
			const strength = (insight.strength * 100).toFixed(0);
			lines.push(`${icon} [${strength}%] ${insight.summary}`);
		}

		lines.push("");
	}

	lines.push(
		`📊 ${result.stats.totalHops} results (${result.stats.edgeHops} via edges, ${result.stats.semanticHops} semantic) across ${result.stats.sourceTypes.length} source types` +
			(result.stats.insightCount > 0
				? `, ${result.stats.insightCount} insight${result.stats.insightCount === 1 ? "" : "s"}`
				: ""),
	);

	return lines.join("\n");
}

/**
 * Format query results for terminal output.
 */
export function formatQuery(result: QueryResult, format: OutputFormat): string {
	if (format === "json") return JSON.stringify(result, null, "\t");
	if (format === "quiet") return "";

	const lines: string[] = [];
	lines.push(`🔎 Query: "${result.query}"\n`);

	for (const r of result.results) {
		const snippet = r.content.slice(0, 120).replace(/\n/g, " ");
		lines.push(`  [${r.score.toFixed(2)}] ${r.sourceType} — ${r.source}`);
		lines.push(`         ${snippet}${r.content.length > 120 ? "..." : ""}`);
		if (r.sourceUrl) lines.push(`         ${r.sourceUrl}`);
		lines.push(`         ID: ${r.storageId}`);
		lines.push("");
	}

	lines.push(`📊 ${result.results.length} results`);
	return lines.join("\n");
}

/**
 * Format collections list for terminal output.
 */
export function formatCollections(
	collections: Array<{
		name: string;
		description?: string;
		chunks: number;
		segments: number;
		model: string;
		updated: string;
	}>,
	format: OutputFormat,
): string {
	if (format === "json") return JSON.stringify(collections, null, "\t");
	if (format === "quiet") return "";

	// Compute column widths
	const nameW = Math.max(4, ...collections.map((c) => c.name.length));
	const chunksW = Math.max(6, ...collections.map((c) => String(c.chunks).length));
	const segsW = Math.max(8, ...collections.map((c) => String(c.segments).length));
	const modelW = Math.max(5, ...collections.map((c) => c.model.length));

	const header = [
		"Name".padEnd(nameW),
		"Chunks".padStart(chunksW),
		"Segments".padStart(segsW),
		"Model".padEnd(modelW),
		"Updated",
	].join("  ");

	const lines = [header, "-".repeat(header.length)];

	for (const c of collections) {
		const updated = c.updated.slice(0, 10); // ISO date only
		lines.push(
			[
				c.name.padEnd(nameW),
				String(c.chunks).padStart(chunksW),
				String(c.segments).padStart(segsW),
				c.model.padEnd(modelW),
				updated,
			].join("  "),
		);
		if (c.description) {
			lines.push(`  ${c.description}`);
		}
	}

	lines.push(`\n${collections.length} collection${collections.length === 1 ? "" : "s"}`);
	return lines.join("\n");
}

/**
 * Format status output.
 */
export function formatStatus(
	projectName: string,
	data: {
		totalChunks: number;
		segments: number;
		embeddingModel: string;
		updatedAt: string;
		overlayEdges?: number;
	},
	format: OutputFormat,
): string {
	if (format === "json") return JSON.stringify({ project: projectName, ...data }, null, "\t");
	if (format === "quiet") return "";

	const lines = [
		`📦 Project: ${projectName}`,
		`   Chunks: ${data.totalChunks}`,
		`   Segments: ${data.segments}`,
		`   Model: ${data.embeddingModel}`,
		`   Updated: ${data.updatedAt}`,
	];

	if (data.overlayEdges && data.overlayEdges > 0) {
		lines.push(
			`   Overlay edges: ${data.overlayEdges} (run materialize-edges to bake into segments)`,
		);
	}

	return lines.join("\n");
}

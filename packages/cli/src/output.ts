import type { QueryResult, TraceHop, TraceResult, TraceView } from "@wtfoc/search";

export type OutputFormat = "human" | "json" | "quiet";

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

/**
 * Format trace results for terminal output.
 * Dispatches to view-specific formatters for human output.
 */
export function formatTrace(result: TraceResult, format: OutputFormat, view?: TraceView): string {
	if (format === "json") return JSON.stringify(result, null, "\t");
	if (format === "quiet") return "";

	const resolvedView = view ?? "evidence";
	switch (resolvedView) {
		case "lineage":
			return formatTraceLineage(result);
		case "timeline":
			return formatTraceTimeline(result);
		case "evidence":
			return formatTraceEvidence(result);
	}
}

function formatHopLine(hop: TraceHop): string[] {
	const lines: string[] = [];
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
	return lines;
}

function formatInsights(result: TraceResult): string[] {
	if (!result.insights || result.insights.length === 0) return [];

	const insightIcons: Record<string, string> = {
		convergence: "🔄",
		"evidence-chain": "🔗",
		"temporal-cluster": "📅",
	};

	const lines: string[] = ["─── Cross-Source Insights ───\n"];
	for (const insight of result.insights) {
		const icon = insightIcons[insight.kind] ?? "💡";
		const strength = (insight.strength * 100).toFixed(0);
		lines.push(`${icon} [${strength}%] ${insight.summary}`);
	}
	lines.push("");
	return lines;
}

function formatStats(result: TraceResult): string {
	return (
		`📊 ${result.stats.totalHops} results (${result.stats.edgeHops} via edges, ${result.stats.semanticHops} semantic) across ${result.stats.sourceTypes.length} source types` +
		(result.stats.insightCount > 0
			? `, ${result.stats.insightCount} insight${result.stats.insightCount === 1 ? "" : "s"}`
			: "")
	);
}

/**
 * Evidence view: grouped by source type (the original/current output).
 */
export function formatTraceEvidence(result: TraceResult): string {
	const lines: string[] = [];
	lines.push(`🔍 Trace: "${result.query}"\n`);

	for (const [sourceType, hops] of Object.entries(result.groups)) {
		const icon = sourceIcons[sourceType] ?? "📎";
		lines.push(`${icon} ${sourceType} (${hops.length} matches)`);

		for (const hop of hops) {
			lines.push(...formatHopLine(hop));
			lines.push("");
		}
	}

	lines.push(...formatInsights(result));
	lines.push(formatStats(result));
	return lines.join("\n");
}

/**
 * Lineage view: causal chains reconstructed from DFS tree.
 */
export function formatTraceLineage(result: TraceResult): string {
	const lines: string[] = [];
	lines.push(`🔍 Trace: "${result.query}"\n`);

	if (result.hops.length === 0) {
		lines.push("No results found.");
		return lines.join("\n");
	}

	// Only show chains with 2+ hops (real traversals). Single-hop seeds go to Related Context.
	// Follows the pattern from insights.ts detectEvidenceChains (3+ source types for insights).
	const chains = result.lineageChains.filter((c) => c.hopIndices.length >= 2);
	const hopsInChains = new Set<number>();

	for (let ci = 0; ci < chains.length; ci++) {
		const chain = chains[ci];
		if (!chain) continue;
		const typeHeader = chain.typeSequence.join(" → ");
		lines.push(`Chain ${ci + 1} (${typeHeader})`);

		for (let si = 0; si < chain.hopIndices.length; si++) {
			const hopIdx = chain.hopIndices[si];
			if (hopIdx == null) continue;
			hopsInChains.add(hopIdx);
			const hop = result.hops[hopIdx];
			if (!hop) continue;
			const icon = sourceIcons[hop.sourceType] ?? "📎";
			const snippet = hop.content.slice(0, 120).replace(/\n/g, " ");
			const score = hop.connection.confidence.toFixed(2);

			lines.push(
				`  ${si + 1}. ${icon} [${hop.sourceType}] ${hop.source}  (${hop.connection.method}, ${score})`,
			);
			lines.push(`     ${snippet}${hop.content.length > 120 ? "..." : ""}`);

			if (hop.connection.method === "edge" && hop.connection.edgeType) {
				lines.push(`     🔗 ${hop.connection.edgeType}: ${hop.connection.evidence ?? ""}`);
			}
			if (hop.sourceUrl) {
				lines.push(`     ${hop.sourceUrl}`);
			}
		}
		lines.push("");
	}

	// Orphan hops not in any chain
	const orphans = result.hops.filter((_, i) => !hopsInChains.has(i));
	if (orphans.length > 0) {
		lines.push("─── Related Context ───\n");
		for (const hop of orphans) {
			lines.push(...formatHopLine(hop));
			lines.push("");
		}
	}

	lines.push(...formatInsights(result));
	lines.push(formatStats(result));
	return lines.join("\n");
}

/**
 * Timeline view: all hops sorted by UTC timestamp.
 */
export function formatTraceTimeline(result: TraceResult): string {
	const lines: string[] = [];
	lines.push(`🔍 Trace: "${result.query}"\n`);

	if (result.hops.length === 0) {
		lines.push("No results found.");
		return lines.join("\n");
	}

	// Sort hops: dated first by timestamp, undated at end. Stable sort by index for ties.
	const indexed = result.hops.map((hop, i) => ({ hop, i }));
	indexed.sort((a, b) => {
		const aDate = parseTimestamp(a.hop.timestamp);
		const bDate = parseTimestamp(b.hop.timestamp);
		if (aDate && bDate) return aDate.getTime() - bDate.getTime() || a.i - b.i;
		if (aDate && !bDate) return -1;
		if (!aDate && bDate) return 1;
		return a.i - b.i;
	});

	let currentDateHeader = "";
	for (const { hop } of indexed) {
		const ts = parseTimestamp(hop.timestamp);
		const dateHeader = ts ? ts.toISOString().slice(0, 10) : "(no timestamp)";

		if (dateHeader !== currentDateHeader) {
			if (currentDateHeader) lines.push("");
			lines.push(`📅 ${dateHeader}`);
			currentDateHeader = dateHeader;
		}

		const icon = sourceIcons[hop.sourceType] ?? "📎";
		const score = hop.connection.confidence.toFixed(2);
		const snippet = hop.content.slice(0, 100).replace(/\n/g, " ");
		lines.push(`  ${icon} [${score}] ${hop.source}`);
		lines.push(`         ${snippet}${hop.content.length > 100 ? "..." : ""}`);
		if (hop.connection.method === "edge" && hop.connection.edgeType) {
			lines.push(`         🔗 ${hop.connection.edgeType}`);
		}
		if (hop.sourceUrl) {
			lines.push(`         ${hop.sourceUrl}`);
		}
	}

	lines.push("");
	lines.push(...formatInsights(result));
	lines.push(formatStats(result));
	return lines.join("\n");
}

/** Parse a timestamp string to Date, returning null for invalid/missing values. */
function parseTimestamp(ts: string | undefined): Date | null {
	if (!ts) return null;
	const d = new Date(ts);
	return Number.isNaN(d.getTime()) ? null : d;
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
		description?: string;
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

	const lines = [`📦 Project: ${projectName}`];
	if (data.description) {
		lines.push(`   ${data.description}`);
	}
	lines.push(
		`   Chunks: ${data.totalChunks}`,
		`   Segments: ${data.segments}`,
		`   Model: ${data.embeddingModel}`,
		`   Updated: ${data.updatedAt}`,
	);

	if (data.overlayEdges && data.overlayEdges > 0) {
		lines.push(
			`   Overlay edges: ${data.overlayEdges} (run materialize-edges to bake into segments)`,
		);
	}

	return lines.join("\n");
}

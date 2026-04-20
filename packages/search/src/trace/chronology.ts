import type { TraceHop } from "./trace.js";

/**
 * Parse an ISO-ish timestamp to epoch ms, returning `null` for missing or
 * unparseable values. Single source of truth so every consumer (trace
 * assembly, CLI timeline view, metrics) applies identical semantics.
 */
export function parseHopTimestampMs(ts: string | undefined): number | null {
	if (!ts) return null;
	const n = Date.parse(ts);
	return Number.isNaN(n) ? null : n;
}

/**
 * Chronological permutation of `hops` indices.
 *
 * Timestamp-ascending; stable tie-break by original traversal index; hops
 * whose timestamp is missing or unparseable are appended at the end in
 * traversal order. Preserves a bijection with `hops` — every index appears
 * exactly once — so consumers can iterate the timeline without re-parsing
 * timestamps or reconciling a shorter list.
 */
export function buildChronologicalHopIndices(hops: TraceHop[]): number[] {
	const dated: Array<{ i: number; ms: number }> = [];
	const undated: number[] = [];
	for (let i = 0; i < hops.length; i++) {
		const hop = hops[i];
		const ms = parseHopTimestampMs(hop?.timestamp);
		if (ms === null) undated.push(i);
		else dated.push({ i, ms });
	}
	dated.sort((a, b) => a.ms - b.ms || a.i - b.i);
	return [...dated.map((d) => d.i), ...undated];
}

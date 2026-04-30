/**
 * Pareto leaderboard for sweep variant ranking. Maintainer-only.
 *
 * Ranks variants on (quality × cost_usd × latency_p95):
 *   quality   higher is better — uses the headline scalar
 *   cost_usd  lower is better — total USD across all substages
 *   latency_p95  lower is better — max p95 latency across substages
 *
 * Variant A dominates variant B iff A is at-least-equal on every
 * axis AND strictly-better on at least one. Non-dominated variants
 * form the Pareto frontier.
 *
 * # Refuse to rank by cost when comparable units missing
 *
 * If ANY variant in the leaderboard has `costComparable.value ===
 * false`, the cost axis is dropped from ranking (the leaderboard
 * still reports cost values, but no variant is marked dominated on
 * cost grounds). Reviewer (peer-review (d)) flagged this as a hard
 * invariant: ranking variants on partial cost data silently rewards
 * unpriced models.
 */

export interface ParetoInput {
	variantId: string;
	/** Headline scalar (higher = better). */
	quality: number;
	/** Total USD cost; null when not measurable. */
	costUsdTotal: number | null;
	/** Max p95 latency in ms; null when no timing recorded. */
	latencyP95Ms: number | null;
	/** Whether the variant's cost is rankable. */
	costComparable: boolean;
	/** Whether this variant passes every hard gate. */
	allGatesPassed: boolean;
}

export interface ParetoRow extends ParetoInput {
	/** True iff no other variant in the input dominates this one. */
	frontier: boolean;
	/** Variant ids that strictly dominate this one (empty when frontier=true). */
	dominatedBy: string[];
	/** True iff cost axis was excluded from ranking (any costComparable=false). */
	costAxisExcluded: boolean;
}

/**
 * Build a Pareto-ranked leaderboard from variant summary rows. Sorted
 * by quality descending; within equal quality, frontier rows come
 * first, then by cost ascending, then by latency ascending.
 */
export function paretoLeaderboard(rows: readonly ParetoInput[]): ParetoRow[] {
	if (rows.length === 0) return [];

	// If any variant lacks costComparable, drop cost from ranking.
	const costAxisExcluded = rows.some((r) => !r.costComparable);

	const dominanceMap = new Map<string, string[]>();
	for (const r of rows) dominanceMap.set(r.variantId, []);

	for (const a of rows) {
		for (const b of rows) {
			if (a.variantId === b.variantId) continue;
			if (dominates(a, b, costAxisExcluded)) {
				dominanceMap.get(b.variantId)?.push(a.variantId);
			}
		}
	}

	const out: ParetoRow[] = rows.map((r) => {
		const dominators = dominanceMap.get(r.variantId) ?? [];
		return {
			...r,
			frontier: dominators.length === 0,
			dominatedBy: dominators,
			costAxisExcluded,
		};
	});

	out.sort((x, y) => {
		if (x.quality !== y.quality) return y.quality - x.quality;
		if (x.frontier !== y.frontier) return x.frontier ? -1 : 1;
		const xc = x.costUsdTotal ?? Number.POSITIVE_INFINITY;
		const yc = y.costUsdTotal ?? Number.POSITIVE_INFINITY;
		if (xc !== yc) return xc - yc;
		const xl = x.latencyP95Ms ?? Number.POSITIVE_INFINITY;
		const yl = y.latencyP95Ms ?? Number.POSITIVE_INFINITY;
		return xl - yl;
	});

	return out;
}

/**
 * Variant A dominates variant B iff:
 *   - A.quality >= B.quality
 *   - cost axis (when included): A.costUsdTotal <= B.costUsdTotal
 *   - latency axis: A.latencyP95Ms <= B.latencyP95Ms
 *   - AND A is strictly-better on at least ONE axis.
 *
 * `null` values on cost/latency are treated as worst-case
 * (Number.POSITIVE_INFINITY) so a variant with measurements is never
 * dominated by one without.
 */
function dominates(a: ParetoInput, b: ParetoInput, costAxisExcluded: boolean): boolean {
	const aCost = a.costUsdTotal ?? Number.POSITIVE_INFINITY;
	const bCost = b.costUsdTotal ?? Number.POSITIVE_INFINITY;
	const aLat = a.latencyP95Ms ?? Number.POSITIVE_INFINITY;
	const bLat = b.latencyP95Ms ?? Number.POSITIVE_INFINITY;

	if (a.quality < b.quality) return false;
	if (!costAxisExcluded && aCost > bCost) return false;
	if (aLat > bLat) return false;

	const strict =
		a.quality > b.quality ||
		(!costAxisExcluded && aCost < bCost) ||
		aLat < bLat;
	return strict;
}

export function formatLeaderboard(rows: readonly ParetoRow[]): string {
	if (rows.length === 0) return "(no variants in leaderboard)\n";
	const header = [
		"  *  variantId                   | quality  | cost_usd | latencyP95 | gates | dominated by",
		"-----+---------------------------+----------+----------+-----------+--------+-------------",
	];
	const lines = rows.map((r) => {
		const star = r.frontier ? " ★ " : "   ";
		const idCol = r.variantId.padEnd(27).slice(0, 27);
		const qualCol = r.quality.toFixed(3).padEnd(8);
		const costCol = r.costAxisExcluded
			? "  --    "
			: r.costUsdTotal === null
				? " null   "
				: `$${r.costUsdTotal.toFixed(4)}`.padEnd(8);
		const latCol =
			r.latencyP95Ms === null ? " null     " : `${Math.round(r.latencyP95Ms)}ms`.padEnd(10);
		const gatesCol = r.allGatesPassed ? " ✓ all  " : " ✗ fail ";
		const domCol = r.dominatedBy.length > 0 ? r.dominatedBy.join(", ") : "—";
		return `${star} ${idCol} | ${qualCol} | ${costCol} | ${latCol} | ${gatesCol} | ${domCol}`;
	});
	let footer = "";
	if (rows.some((r) => r.costAxisExcluded)) {
		footer =
			"\n(cost axis excluded — at least one variant had costComparable=false)\n";
	}
	return `${header.join("\n")}\n${lines.join("\n")}${footer}`;
}

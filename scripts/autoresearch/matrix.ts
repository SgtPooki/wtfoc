/**
 * Variant matrix types for the autoresearch sweep harness.
 * Maintainer-only.
 *
 * A `Matrix` describes a Cartesian product of knob values that fan
 * out to N variants. Each variant maps to dogfood CLI flags + env
 * vars; the sweep driver runs them sequentially and captures
 * ExtendedDogfoodReport for each.
 *
 * Example (retrieval-only matrix):
 *
 *   {
 *     name: "retrieval-baseline",
 *     baseConfig: { collection: "filoz-ecosystem-2026-04-v12", embedder: ... },
 *     axes: {
 *       autoRoute: [false, true],
 *       diversityEnforce: [false, true],
 *       reranker: ["off", { type: "llm", url: "...", model: "haiku" }],
 *     },
 *   }
 *
 * → 2 × 2 × 2 = 8 variants. The driver enumerates the cartesian
 * product, builds CLI args for each, runs `pnpm dogfood ... --output
 * <tmpfile>`, reads the report, and emits a Pareto-rankable comparison.
 *
 * Phase 2 ships matrix-author UX as TypeScript objects (not YAML).
 * Reasons:
 *   - type safety on knob names and value types
 *   - inline comments per axis explaining why a knob is being swept
 *   - no new dependency (yaml package etc.)
 *   - matrices live in source control, diffable, reviewable
 */

/**
 * Two-corpus pair. The headline scalar is `sqrt(primary × secondary)`
 * computed on portable-tier pass rates. `secondary` is optional —
 * single-corpus matrices fall back to `portable_primary` directly.
 */
export interface CorpusPair {
	primary: string;
	secondary?: string;
}

export interface BaseConfig {
	/**
	 * Legacy single-corpus shape (pre-cross-corpus harness). Kept so
	 * existing matrix files keep loading. New matrices should set
	 * `collections` instead.
	 */
	collection?: string;
	/** Cross-corpus shape — primary required, secondary optional. */
	collections?: CorpusPair;
	embedderUrl: string;
	embedderModel: string;
	embedderKey?: string;
	embedderCacheDir?: string;
	extractorUrl?: string;
	extractorModel?: string;
	extractorKey?: string;
}

/**
 * Resolve the effective corpus pair from a BaseConfig that may use
 * the legacy `collection` field, the new `collections` field, or
 * (illegally) both. Throws when both or neither are set.
 */
export function normalizeCollections(baseConfig: BaseConfig): CorpusPair {
	const legacy = baseConfig.collection;
	const modern = baseConfig.collections;
	if (legacy && modern) {
		throw new Error(
			`matrix baseConfig sets both "collection" (legacy) and "collections" (cross-corpus); pick one`,
		);
	}
	if (legacy) return { primary: legacy };
	if (modern) {
		if (!modern.primary) {
			throw new Error(`matrix baseConfig.collections.primary is required`);
		}
		return modern;
	}
	throw new Error(
		`matrix baseConfig must set either "collection" (single-corpus) or "collections.primary"`,
	);
}

export type RerankerSpec =
	| "off"
	| { type: "bge"; url: string }
	| { type: "llm"; url: string; model: string; apiKey?: string };

export interface VariantAxes {
	/**
	 * `--auto-route` flag — persona-based source-type boosts.
	 */
	autoRoute?: boolean[];
	/**
	 * `--diversity-enforce` flag — source-type diversity in top-K.
	 */
	diversityEnforce?: boolean[];
	/**
	 * Reranker selection: "off" disables, otherwise spec describes the
	 * reranker to wire in. Each entry generates one variant.
	 */
	reranker?: RerankerSpec[];
	/** topK override — `--top-k` flag. Each entry generates one variant. */
	topK?: number[];
	/** traceMaxPerSource override — `--trace-max-per-source`. */
	traceMaxPerSource?: number[];
	/** traceMaxTotal override — `--trace-max-total`. */
	traceMaxTotal?: number[];
	/** traceMinScore override — `--trace-min-score`. */
	traceMinScore?: number[];
}

/**
 * A concrete variant — one point in the Cartesian product. Carries
 * the axis values that were chosen for it, plus a generated
 * `variantId` for log/report correlation.
 */
export interface Variant {
	variantId: string;
	axes: {
		autoRoute: boolean;
		diversityEnforce: boolean;
		reranker: RerankerSpec;
		topK?: number;
		traceMaxPerSource?: number;
		traceMaxTotal?: number;
		traceMinScore?: number;
	};
}

export interface Matrix {
	/**
	 * Short name for the matrix; surfaces in run-log rows and the
	 * leaderboard. Use kebab-case.
	 */
	name: string;
	/**
	 * Free-text description — what is this sweep trying to learn?
	 */
	description: string;
	/**
	 * Static config shared across every variant.
	 */
	baseConfig: BaseConfig;
	axes: VariantAxes;
	/**
	 * Variant id treated as the production config for cron-style
	 * regression detection. Optional — matrices without a production
	 * anchor (exploratory sweeps) leave it unset.
	 */
	productionVariantId?: string;
}

/**
 * Enumerate every variant a matrix produces. Order is stable across
 * runs (lexicographic on axis order: autoRoute → diversityEnforce →
 * reranker) so logged variantIds round-trip across reruns of the same
 * matrix.
 */
export function enumerateVariants(matrix: Matrix): Variant[] {
	const autoRouteValues = matrix.axes.autoRoute ?? [false];
	const diversityValues = matrix.axes.diversityEnforce ?? [false];
	const rerankerValues = matrix.axes.reranker ?? ["off" as const];
	const topKValues: (number | undefined)[] =
		matrix.axes.topK && matrix.axes.topK.length > 0 ? [...matrix.axes.topK] : [undefined];
	const traceMaxPerSourceValues: (number | undefined)[] =
		matrix.axes.traceMaxPerSource && matrix.axes.traceMaxPerSource.length > 0
			? [...matrix.axes.traceMaxPerSource]
			: [undefined];
	const traceMaxTotalValues: (number | undefined)[] =
		matrix.axes.traceMaxTotal && matrix.axes.traceMaxTotal.length > 0
			? [...matrix.axes.traceMaxTotal]
			: [undefined];
	const traceMinScoreValues: (number | undefined)[] =
		matrix.axes.traceMinScore && matrix.axes.traceMinScore.length > 0
			? [...matrix.axes.traceMinScore]
			: [undefined];

	const out: Variant[] = [];
	for (const ar of autoRouteValues) {
		for (const div of diversityValues) {
			for (const rr of rerankerValues) {
				for (const tk of topKValues) {
					for (const tps of traceMaxPerSourceValues) {
						for (const tmt of traceMaxTotalValues) {
							for (const tms of traceMinScoreValues) {
								const variantId = formatVariantId(ar, div, rr, tk, tps, tmt, tms);
								const axes: Variant["axes"] = { autoRoute: ar, diversityEnforce: div, reranker: rr };
								if (tk !== undefined) axes.topK = tk;
								if (tps !== undefined) axes.traceMaxPerSource = tps;
								if (tmt !== undefined) axes.traceMaxTotal = tmt;
								if (tms !== undefined) axes.traceMinScore = tms;
								out.push({ variantId, axes });
							}
						}
					}
				}
			}
		}
	}
	return out;
}

/**
 * Filter an enumerated variant list to only those whose `variantId`
 * appears in `allowList`. Used by the sweep driver's
 * `--variant-filter` flag for Stage 2 shortlist reruns.
 *
 * Throws when any allowList entry does not match a known variantId —
 * a typo would silently shrink the sweep, which is worse than failing
 * loudly.
 */
export function filterVariants(variants: Variant[], allowList: string[]): Variant[] {
	const known = new Set(variants.map((v) => v.variantId));
	const unknown = allowList.filter((id) => !known.has(id));
	if (unknown.length > 0) {
		throw new Error(
			`unknown variantIds in --variant-filter: ${unknown.join(", ")} (known: ${[...known].join(", ")})`,
		);
	}
	const wanted = new Set(allowList);
	return variants.filter((v) => wanted.has(v.variantId));
}

function formatVariantId(
	autoRoute: boolean,
	diversityEnforce: boolean,
	reranker: RerankerSpec,
	topK?: number,
	traceMaxPerSource?: number,
	traceMaxTotal?: number,
	traceMinScore?: number,
): string {
	const ar = autoRoute ? "ar" : "noar";
	const div = diversityEnforce ? "div" : "nodiv";
	const rr =
		reranker === "off"
			? "rrOff"
			: reranker.type === "bge"
				? "rrBge"
				: `rrLlm-${reranker.model}`;
	const numeric: string[] = [];
	if (topK !== undefined) numeric.push(`k${topK}`);
	if (traceMaxPerSource !== undefined) numeric.push(`tps${traceMaxPerSource}`);
	if (traceMaxTotal !== undefined) numeric.push(`tmt${traceMaxTotal}`);
	if (traceMinScore !== undefined) numeric.push(`tms${traceMinScore.toFixed(2).replace(/\./, "p")}`);
	const numericTag = numeric.length > 0 ? `_${numeric.join("_")}` : "";
	return `${ar}_${div}_${rr}${numericTag}`;
}

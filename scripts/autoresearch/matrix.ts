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

export interface BaseConfig {
	collection: string;
	embedderUrl: string;
	embedderModel: string;
	embedderKey?: string;
	embedderCacheDir?: string;
	extractorUrl?: string;
	extractorModel?: string;
	extractorKey?: string;
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
	const out: Variant[] = [];
	for (const ar of autoRouteValues) {
		for (const div of diversityValues) {
			for (const rr of rerankerValues) {
				const variantId = formatVariantId(ar, div, rr);
				out.push({
					variantId,
					axes: { autoRoute: ar, diversityEnforce: div, reranker: rr },
				});
			}
		}
	}
	return out;
}

function formatVariantId(autoRoute: boolean, diversityEnforce: boolean, reranker: RerankerSpec): string {
	const ar = autoRoute ? "ar" : "noar";
	const div = diversityEnforce ? "div" : "nodiv";
	const rr =
		reranker === "off"
			? "rrOff"
			: reranker.type === "bge"
				? "rrBge"
				: `rrLlm-${reranker.model}`;
	return `${ar}_${div}_${rr}`;
}

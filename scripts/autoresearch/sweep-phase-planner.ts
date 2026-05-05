/**
 * Sweep phase planner. Given a matrix's per-component endpoint set,
 * produce an ordered embed → search → score plan with the GPU mode each
 * phase needs (null when the phase is fully cloud or unused).
 *
 * Step 5 of the 3-phase sweep refactor. The planner is pure: it does
 * not call vllm-admin, does not touch disk, and emits a deterministic
 * plan from the matrix shape alone. Step 6 wires it into sweep.ts and
 * inserts an `ensureMode` call between phases.
 *
 * Component mode resolution (per gemini peer-review suggestion):
 *
 *   - URL not on the admin host → "cloud" (no GPU mode required)
 *   - URL on admin host, substring `embedder-gpu` → "embed-gpu"
 *   - URL on admin host, substring `reranker-gpu` → "rerank-gpu"
 *   - URL on admin host, no `-gpu` suffix         → "chat"
 *
 * Composition guard: within a single phase, if two variants demand
 * different non-null GPU modes (e.g. one variant wants `rerank-gpu`,
 * another wants `chat` for the reranker phase) the planner refuses.
 * The 3-phase split prevents the embedder/reranker/extractor mode
 * collision naturally because each component lives in its own phase;
 * the guard catches future misconfigurations that violate that.
 */

import type { GpuMode } from "../lib/mode-switch.js";
import type { RerankerSpec, Variant } from "./matrix.js";

export type ComponentMode = GpuMode | "cloud";
export type PhaseName = "embed" | "search" | "score";

export interface PhasePlan {
	phase: PhaseName;
	/**
	 * GPU mode required to run this phase. null when no variant in the
	 * matrix exercises a local workload for this phase (all cloud, or
	 * the component is absent — e.g. reranker=off across every variant).
	 * `ensureMode` is only called when this is non-null.
	 */
	mode: GpuMode | null;
	/**
	 * True when no variant participates in this phase at all (e.g. every
	 * variant has reranker=off → the search phase still runs vector
	 * retrieval, so this stays false; but the score phase is `skip` when
	 * grounding is off and the deterministic-scoring evaluator is the
	 * only consumer of the cached search output).
	 */
	skip: boolean;
}

export interface PlanSweepPhasesInput {
	embedderUrl: string;
	extractorUrl?: string | undefined;
	variants: Variant[];
	/**
	 * Hostname (or full origin) of the vllm-admin cluster. URLs whose
	 * host matches this prefix are subject to GPU-mode classification;
	 * URLs whose host does not match are treated as "cloud" and require
	 * no mode swap. When null or empty, every URL is "cloud" — useful
	 * for full-cloud sweeps that should produce a 0-swap plan.
	 */
	adminHost: string | null;
	/**
	 * When grounding is enabled the score phase will run an LLM
	 * extractor against the cached search results, so it inherits the
	 * extractor's mode. When false the score phase has no GPU
	 * dependency and is marked `skip: true`.
	 */
	groundingEnabled?: boolean;
}

export class PhaseCompositionError extends Error {
	constructor(
		public readonly phase: PhaseName,
		public readonly conflicts: Array<{ owner: string; mode: GpuMode }>,
	) {
		const detail = conflicts
			.map((c) => `${c.owner}=${c.mode}`)
			.join(", ");
		super(
			`phase=${phase}: incompatible local GPU modes across variants — ${detail}. The 3-phase planner cannot pre-stage two non-null modes for the same phase; split the matrix or move the conflicting component to a different phase.`,
		);
		this.name = "PhaseCompositionError";
	}
}

/**
 * Classify a single URL into "cloud" or a concrete GPU mode. Pure.
 *
 * GPU-mode markers (`embedder-gpu`, `reranker-gpu`) are honored
 * regardless of host: a vllm-admin cluster typically exposes those
 * workloads on dedicated subdomains that share only a parent domain
 * with the admin URL, so a strict prefix/substring check on the admin
 * host would miss them. The admin host is still used to classify
 * generic chat endpoints — a URL with no GPU marker on the admin host
 * is the chat workload; off-admin URLs with no marker are cloud.
 */
export function resolveRequiredMode(
	url: string | undefined,
	adminHost: string | null,
): ComponentMode | null {
	if (!url) return null;
	if (url.includes("embedder-gpu")) return "embed-gpu";
	if (url.includes("reranker-gpu")) return "rerank-gpu";
	if (!adminHost) return "cloud";
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		return "cloud";
	}
	const adminHostNormalized = (() => {
		try {
			return new URL(adminHost).hostname;
		} catch {
			// Strip any port suffix from a bare host string so the
			// parent-domain comparison stays apples-to-apples.
			return adminHost.replace(/:\d+$/, "");
		}
	})();
	// Compare on the parent-domain level (last two labels) so an admin
	// URL like `admin.example.com` matches a chat endpoint at
	// `chat.example.com` even though their leftmost labels differ.
	const parentOf = (h: string): string => {
		const parts = h.split(".");
		if (parts.length < 2) return h;
		return parts.slice(-2).join(".");
	};
	if (parentOf(host) !== parentOf(adminHostNormalized)) return "cloud";
	return "chat";
}

function rerankerUrl(spec: RerankerSpec): string | undefined {
	if (spec === "off") return undefined;
	return spec.url;
}

function reduceModes(
	modes: Array<{ owner: string; mode: ComponentMode | null }>,
	phase: PhaseName,
): GpuMode | null {
	const local = modes.filter(
		(m): m is { owner: string; mode: GpuMode } =>
			m.mode !== null && m.mode !== "cloud",
	);
	const [first] = local;
	if (!first) return null;
	const distinct = new Set(local.map((m) => m.mode));
	if (distinct.size > 1) {
		throw new PhaseCompositionError(phase, local);
	}
	return first.mode;
}

/**
 * Produce an embed → search → score phase plan. Throws
 * PhaseCompositionError when two variants disagree on the GPU mode
 * required by the same phase.
 */
export function planSweepPhases(input: PlanSweepPhasesInput): PhasePlan[] {
	const adminHost = input.adminHost ?? null;
	const embedMode = reduceModes(
		[
			{
				owner: `embedder(${input.embedderUrl})`,
				mode: resolveRequiredMode(input.embedderUrl, adminHost),
			},
		],
		"embed",
	);

	const rerankerEntries = input.variants.map((v) => ({
		owner: `variant(${v.variantId}).reranker`,
		mode: resolveRequiredMode(rerankerUrl(v.axes.reranker), adminHost),
	}));
	const searchMode = reduceModes(rerankerEntries, "search");

	const extractorMode = reduceModes(
		[
			{
				owner: `extractor(${input.extractorUrl ?? "none"})`,
				mode: resolveRequiredMode(input.extractorUrl, adminHost),
			},
		],
		"score",
	);
	const groundingEnabled = input.groundingEnabled ?? false;

	return [
		{ phase: "embed", mode: embedMode, skip: false },
		{
			phase: "search",
			mode: searchMode,
			// Search phase always runs vector retrieval; reranker is just
			// optional. Skip is never true here — the deterministic-
			// scoring evaluator is the actual workload.
			skip: false,
		},
		{
			phase: "score",
			// Score phase needs an LLM only when grounding is wired up.
			// Without grounding, the deterministic-scoring output is
			// already in the search-phase cache and the score phase is a
			// no-op replay → no GPU mode needed. The phase itself still
			// runs (without a swap) so it can re-attach timing / cost
			// telemetry onto the cached EvalStageResult; otherwise the
			// downstream Pareto leaderboard would lose cost+latency.
			mode: groundingEnabled ? extractorMode : null,
			skip: false,
		},
	];
}

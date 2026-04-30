/**
 * Machine-readable knob inventory for the autoresearch loop.
 * Maintainer-only.
 *
 * The autonomous loop's LLM proposer reads this inventory to know what
 * axes it's allowed to explore, the valid value ranges, and which axes
 * are coupled (changing one requires re-running another).
 *
 * Adding a new knob here:
 *  1. Append a `Knob` to KNOBS below.
 *  2. Wire the knob into the matrix runner / sweep — knobs declared
 *     here but not consumed by sweep.ts get filtered out at runtime.
 *  3. The materializer (`materialize-variant.ts`) translates `{ axis,
 *     value }` proposals into matrix overrides; if your knob needs a
 *     non-trivial materialization, extend the materializer.
 *
 * Reverse direction:
 *  - Knobs the LLM should NEVER touch (ingest paths, OpenRouter key,
 *    file outputs, etc.) are not represented here. The proposer can
 *    only emit `{ axis: KNOWN_KNOB_NAME, value: VALID_VALUE }`.
 */

export type KnobValue = boolean | number | string;

export interface KnobBase {
	name: string;
	description: string;
	/**
	 * Whether changing this knob invalidates the embedder cache /
	 * requires a re-ingest. The proposer prefers cheap knobs first.
	 */
	requiresReingest: boolean;
	/**
	 * Other knob names that should be re-evaluated together when this
	 * one changes. Empty = independent. Used for the coupling-graph
	 * follow-up (#311 review item — chunker × embedder coupling).
	 */
	coupledWith: string[];
	/** Production default at the time the inventory was authored. */
	productionDefault: KnobValue;
}

export interface BooleanKnob extends KnobBase {
	type: "boolean";
	productionDefault: boolean;
}

export interface IntKnob extends KnobBase {
	type: "int";
	min: number;
	max: number;
	productionDefault: number;
}

export interface FloatKnob extends KnobBase {
	type: "float";
	min: number;
	max: number;
	productionDefault: number;
}

export interface EnumKnob extends KnobBase {
	type: "enum";
	values: readonly string[];
	productionDefault: string;
}

export type Knob = BooleanKnob | IntKnob | FloatKnob | EnumKnob;

/**
 * Knob inventory. Phase 4.5 starts with the axes the existing matrix
 * surface already supports. Future PRs can grow this — chunker,
 * embedder model, prompt templates, etc.
 */
export const KNOBS: readonly Knob[] = [
	{
		name: "autoRoute",
		description:
			"Persona-based source-type boosts at retrieval time. Phase 3 evidence: harmful on every measured config (#314). Production default: false.",
		type: "boolean",
		productionDefault: false,
		requiresReingest: false,
		coupledWith: [],
	},
	{
		name: "diversityEnforce",
		description:
			"Enforce source-type diversity in the top-K results. Phase 3 evidence: +11pp portable lift; production-mandatory.",
		type: "boolean",
		productionDefault: true,
		requiresReingest: false,
		coupledWith: ["reranker"],
	},
	{
		name: "reranker",
		description:
			"Reranker selection. 'off' = no reranker. 'llm:haiku' = LLM rerank via local proxy. 'bge' = cross-encoder via local sidecar. Phase 3 evidence: LLM rerankers regress quality on diversityEnforce; bge cross-encoder pending #319.",
		type: "enum",
		values: ["off", "llm:haiku", "bge"],
		productionDefault: "off",
		requiresReingest: false,
		coupledWith: ["diversityEnforce"],
	},
	{
		name: "topK",
		description:
			"Number of top retrieved candidates returned to the synthesizer. Production default: 10. Wider K may help recall but adds noise.",
		type: "int",
		min: 5,
		max: 25,
		productionDefault: 10,
		requiresReingest: false,
		coupledWith: ["diversityEnforce"],
	},
	{
		name: "traceMaxPerSource",
		description:
			"Cap on chunks per source-type during retrieval expansion. Lower = more diversity, higher = deeper per-source coverage.",
		type: "int",
		min: 1,
		max: 10,
		productionDefault: 3,
		requiresReingest: false,
		coupledWith: ["diversityEnforce", "topK"],
	},
	{
		name: "traceMaxTotal",
		description:
			"Hard cap on total chunks visited during retrieval expansion. Production default: 15.",
		type: "int",
		min: 5,
		max: 50,
		productionDefault: 15,
		requiresReingest: false,
		coupledWith: ["topK"],
	},
	{
		name: "traceMinScore",
		description:
			"Minimum cosine similarity for a chunk to enter the trace. Production default: 0.3.",
		type: "float",
		min: 0.1,
		max: 0.6,
		productionDefault: 0.3,
		requiresReingest: false,
		coupledWith: [],
	},
];

const knobByName = new Map<string, Knob>(KNOBS.map((k) => [k.name, k]));

export function getKnob(name: string): Knob | undefined {
	return knobByName.get(name);
}

/**
 * Validate a proposed `{ axis, value }` pair against the inventory.
 * Returns null when valid, or a string describing why it's invalid.
 */
export function validateProposal(name: string, value: unknown): string | null {
	const knob = getKnob(name);
	if (!knob) return `unknown knob: ${name}`;
	switch (knob.type) {
		case "boolean":
			return typeof value === "boolean" ? null : `expected boolean for ${name}, got ${typeof value}`;
		case "int": {
			if (typeof value !== "number" || !Number.isInteger(value))
				return `expected integer for ${name}, got ${value}`;
			if (value < knob.min || value > knob.max)
				return `${name} ${value} outside [${knob.min}, ${knob.max}]`;
			return null;
		}
		case "float": {
			if (typeof value !== "number" || !Number.isFinite(value))
				return `expected number for ${name}, got ${value}`;
			if (value < knob.min || value > knob.max)
				return `${name} ${value} outside [${knob.min}, ${knob.max}]`;
			return null;
		}
		case "enum": {
			if (typeof value !== "string") return `expected string enum for ${name}, got ${typeof value}`;
			if (!knob.values.includes(value))
				return `${name} '${value}' not in enum [${knob.values.join(", ")}]`;
			return null;
		}
	}
}

/**
 * One-line summary suitable for an LLM prompt. The proposer reads this
 * to understand the search space.
 */
export function knobsToPromptLines(): string[] {
	return KNOBS.map((k) => {
		const couplingNote =
			k.coupledWith.length > 0 ? ` [coupled-with: ${k.coupledWith.join(", ")}]` : "";
		const reingestNote = k.requiresReingest ? " [requires-reingest]" : "";
		switch (k.type) {
			case "boolean":
				return `- ${k.name} (boolean, default=${k.productionDefault})${reingestNote}${couplingNote}: ${k.description}`;
			case "int":
			case "float":
				return `- ${k.name} (${k.type}, [${k.min}, ${k.max}], default=${k.productionDefault})${reingestNote}${couplingNote}: ${k.description}`;
			case "enum":
				return `- ${k.name} (enum {${k.values.join(", ")}}, default=${k.productionDefault})${reingestNote}${couplingNote}: ${k.description}`;
		}
	});
}

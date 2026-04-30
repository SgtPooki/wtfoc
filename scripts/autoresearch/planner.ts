/**
 * Exploration planner for the autonomous loop. Maintainer-only.
 *
 * The naive design (#333 MVP) gave the LLM free reign to propose any
 * axis it wanted on every cycle. Peer review flagged that without a
 * deterministic order, the LLM thrashes on cheap booleans and never
 * deliberately probes the numeric / coupled space.
 *
 * The planner sits AHEAD of the LLM:
 *   1. Reads the knob inventory + the tried-log.
 *   2. Ranks knobs by exploration phase: cheap-uncoupled → cheap-coupled
 *      → expensive (re-ingest) → code-change (when wired).
 *   3. Within each phase, ranks knob VALUES that haven't been tried
 *      within the silence window. For numeric knobs, generates a 3-point
 *      probe (min, mid, max) before binary-searching.
 *   4. Returns the next candidate `{ axis, value }` to attempt.
 *
 * The LLM still produces the rationale + can override the planner's
 * suggestion (when `analyze-and-propose` returns its own proposal, that
 * wins). But when the LLM emits `axis: null` or returns nothing useful,
 * the planner's queue keeps the loop productive.
 */

import {
	type BooleanKnob,
	type EnumKnob,
	type FloatKnob,
	type IntKnob,
	type Knob,
	getKnob,
	materializableKnobs,
} from "./knobs.js";
import { alreadyTried, type TriedLogRow } from "./tried-log.js";

export type Phase = "cheap-uncoupled" | "cheap-coupled" | "expensive" | "code-change";

export interface PlannerInputs {
	matrixName: string;
	triedRows: readonly TriedLogRow[];
	silenceDays?: number;
	/** Override the inventory (testing). */
	knobs?: readonly Knob[];
	/** Skip code-change phase suggestions (default: true until #334-E lands). */
	skipCodeChange?: boolean;
}

export interface PlannerSuggestion {
	axis: string;
	value: boolean | number | string;
	phase: Phase;
	rationale: string;
}

function phaseFor(knob: Knob): Phase {
	if (knob.requiresReingest) return "expensive";
	return knob.coupledWith.length > 0 ? "cheap-coupled" : "cheap-uncoupled";
}

const PHASE_ORDER: Phase[] = ["cheap-uncoupled", "cheap-coupled", "expensive", "code-change"];

function valuesForKnob(knob: Knob): (boolean | number | string)[] {
	switch (knob.type) {
		case "boolean": {
			const k = knob as BooleanKnob;
			return [!k.productionDefault, k.productionDefault];
		}
		case "enum": {
			const k = knob as EnumKnob;
			// Production default last so the planner tries the alternative
			// before re-confirming the current production cell.
			return k.values.filter((v) => v !== k.productionDefault).concat([k.productionDefault]);
		}
		case "int": {
			const k = knob as IntKnob;
			// 3-point probe: min, mid, max. Production default skipped if
			// it's already in the probe list.
			const mid = Math.round((k.min + k.max) / 2);
			const probes = Array.from(new Set([k.min, mid, k.max])).filter(
				(v) => v !== k.productionDefault,
			);
			return probes;
		}
		case "float": {
			const k = knob as FloatKnob;
			const mid = Number(((k.min + k.max) / 2).toFixed(2));
			const probes = Array.from(new Set([k.min, mid, k.max])).filter(
				(v) => Math.abs(v - k.productionDefault) > 1e-9,
			);
			return probes;
		}
	}
}

/**
 * Pick the next exploration candidate. Returns null when every
 * materializable knob × value tuple has been tried within the
 * silence window.
 */
export function planNextCandidate(input: PlannerInputs): PlannerSuggestion | null {
	const knobs = input.knobs ?? materializableKnobs();
	const silenceDays = input.silenceDays ?? 30;
	const skipCodeChange = input.skipCodeChange ?? true;

	for (const phase of PHASE_ORDER) {
		if (skipCodeChange && phase === "code-change") continue;
		const phaseKnobs = knobs.filter((k) => phaseFor(k) === phase);
		for (const k of phaseKnobs) {
			for (const v of valuesForKnob(k)) {
				const prior = alreadyTried(input.triedRows, input.matrixName, k.name, v, silenceDays);
				if (prior) continue;
				return {
					axis: k.name,
					value: v,
					phase,
					rationale:
						`planner: phase=${phase} knob=${k.name} value=${JSON.stringify(v)} ` +
						`(production default=${JSON.stringify(k.productionDefault)}; ` +
						`coupledWith=${k.coupledWith.length > 0 ? k.coupledWith.join(",") : "none"})`,
				};
			}
		}
	}
	return null;
}

/**
 * Validate an LLM-supplied proposal against the planner's allowed
 * candidate space. Returns the planner's preferred candidate when the
 * LLM proposed something the planner would skip (already tried or
 * unmaterializable); returns null when the LLM's proposal is acceptable.
 *
 * Used by autonomous-loop to nudge the LLM back on track without
 * silently overriding it.
 */
export function reconcileWithPlanner(
	input: PlannerInputs,
	llmProposal: { axis: string; value: boolean | number | string },
): PlannerSuggestion | null {
	const knob = getKnob(llmProposal.axis);
	if (!knob || !knob.materialized) return planNextCandidate(input);
	const prior = alreadyTried(
		input.triedRows,
		input.matrixName,
		llmProposal.axis,
		llmProposal.value,
		input.silenceDays ?? 30,
	);
	if (prior) return planNextCandidate(input);
	return null; // LLM proposal is fine
}

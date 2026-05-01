/**
 * Local-LLM analyzer + proposer for the autoresearch loop.
 * Maintainer-only.
 *
 * Calls a local OpenAI-compatible chat completions endpoint (defaults
 * to `http://127.0.0.1:4523/v1`; override via `WTFOC_ANALYSIS_LLM_URL`).
 * Sends:
 *   - knob inventory (machine-readable axes)
 *   - tried-log compact summary (what's already been explored)
 *   - explain-finding markdown (flipped queries + per-tier breakdown)
 *
 * Receives:
 *   - markdown analysis (root-cause hypothesis, what to investigate)
 *   - structured proposal `{ axis, value, rationale }` or null
 *
 * The proposal is validated against the knob inventory before being
 * returned. Invalid proposals are dropped (with reasons surfaced) so
 * downstream materializers never see ill-formed inputs.
 *
 * No paid AI in the recurring path. Calls fail-soft on transport
 * errors — the cron should still file the underlying regression
 * issue even if the LLM is unreachable.
 */

import { knobsToPromptLines, validateProposal } from "./knobs.js";
import { type TriedLogRow, triedLogPromptLines } from "./tried-log.js";

export const DEFAULT_LLM_URL = "http://127.0.0.1:4523/v1";
export const DEFAULT_LLM_MODEL = "haiku";

export interface AnalyzeProposeInputs {
	matrixName: string;
	explainMarkdown: string;
	triedRows: readonly TriedLogRow[];
	llmUrl?: string;
	llmModel?: string;
	llmApiKey?: string;
	timeoutMs?: number;
	/** Override the fetch implementation (testing). */
	fetchFn?: typeof fetch;
}

export interface Proposal {
	axis: string;
	value: boolean | number | string;
	rationale: string;
}

export interface AnalyzeProposeResult {
	ok: boolean;
	analysisMarkdown: string;
	proposal: Proposal | null;
	llmCallSucceeded: boolean;
	error?: string;
	rawContent?: string;
}

const SYSTEM_PROMPT = `You are an autoresearch agent for a retrieval system called wtfoc.

Your job: given a regression or breach finding, propose ONE concrete config tweak that you believe will recover the regression OR explain that no proposal is appropriate.

You will be given:
- The regression finding (variant, corpus, metric, latest vs baseline numbers)
- A list of flipped queries (passed in baseline, failed in latest) with their retrieved chunks
- The full knob inventory (axes you may propose changes to, with valid ranges)
- A summary of past attempts on this matrix (so you don't repeat yourself)

Rules:
1. Output exactly two sections, in order:
   - "## Analysis" — your root-cause hypothesis and reasoning
   - "## Proposal" — a fenced JSON block with one of:
       * { "axis": "<knob name>", "value": <valid value>, "rationale": "<one sentence>" }
       * { "axis": null }   (when no proposal is appropriate)
2. The axis MUST be one of the inventory names. The value MUST satisfy the knob's type and range.
3. Do NOT propose a knob+value combination that already appears in the tried-log within the recent window — pick a different axis or value.
4. Keep the analysis under 300 words. The rationale string under 200 chars.
5. Prefer cheap knobs (no re-ingest required) over expensive ones unless the cheap space is exhausted.
6. If the finding is a breach (hard gate floor violated), your proposal should target the breached metric specifically.
7. If you have no high-confidence proposal, emit { "axis": null }. The maintainer would rather see "I don't know" than a random walk.`;

export function buildUserPrompt(input: {
	matrixName: string;
	explainMarkdown: string;
	triedRows: readonly TriedLogRow[];
}): string {
	const knobLines = knobsToPromptLines();
	const triedLines = triedLogPromptLines(input.triedRows, input.matrixName);
	return [
		"# Knob inventory (only these axes may be proposed)",
		"",
		...knobLines,
		"",
		"# Past attempts on this matrix (do not repeat (axis, value) within window)",
		"",
		...triedLines,
		"",
		"# Finding context",
		"",
		input.explainMarkdown,
	].join("\n");
}

interface OpenAIChatCompletionResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Best-effort parse of the LLM's "## Proposal" block. Tolerant of
 * formatting drift — strips backticks, JSON-block fences, and trailing
 * commas before parsing.
 */
export function parseProposalBlock(content: string): Proposal | null {
	const idx = content.indexOf("## Proposal");
	if (idx < 0) return null;
	const after = content.slice(idx);
	const jsonMatch = after.match(/```(?:json)?\s*([\s\S]*?)```/);
	const raw = (jsonMatch ? jsonMatch[1] : after).trim();
	const cleaned = raw.replace(/^[^{]*/, "").replace(/[^}]*$/, "");
	try {
		const parsed = JSON.parse(cleaned) as { axis?: unknown; value?: unknown; rationale?: unknown };
		if (parsed.axis === null || parsed.axis === undefined) return null;
		if (typeof parsed.axis !== "string") return null;
		const v = parsed.value;
		if (
			typeof v !== "boolean" &&
			typeof v !== "number" &&
			typeof v !== "string"
		)
			return null;
		const rationale = typeof parsed.rationale === "string" ? parsed.rationale : "";
		return { axis: parsed.axis, value: v, rationale };
	} catch {
		return null;
	}
}

export async function analyzeAndPropose(
	input: AnalyzeProposeInputs,
): Promise<AnalyzeProposeResult> {
	const url = input.llmUrl ?? process.env.WTFOC_ANALYSIS_LLM_URL ?? DEFAULT_LLM_URL;
	const model = input.llmModel ?? process.env.WTFOC_ANALYSIS_LLM_MODEL ?? DEFAULT_LLM_MODEL;
	const apiKey = input.llmApiKey ?? process.env.WTFOC_ANALYSIS_LLM_API_KEY ?? "";
	const fetchFn = input.fetchFn ?? fetch;
	const envTimeout = process.env.WTFOC_LLM_TIMEOUT_MS
		? Number.parseInt(process.env.WTFOC_LLM_TIMEOUT_MS, 10)
		: undefined;
	const timeoutMs =
		input.timeoutMs ?? (envTimeout && Number.isFinite(envTimeout) ? envTimeout : 300_000);

	const userPrompt = buildUserPrompt({
		matrixName: input.matrixName,
		explainMarkdown: input.explainMarkdown,
		triedRows: input.triedRows,
	});

	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	try {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		const res = await fetchFn(`${url.replace(/\/+$/, "")}/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				temperature: 0.2,
				max_tokens: 1500,
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{ role: "user", content: userPrompt },
				],
			}),
			signal: ac.signal,
		});
		if (!res.ok) {
			return {
				ok: false,
				analysisMarkdown: "",
				proposal: null,
				llmCallSucceeded: false,
				error: `LLM HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`,
			};
		}
		const body = (await res.json()) as OpenAIChatCompletionResponse;
		const content = body.choices?.[0]?.message?.content ?? "";
		const proposal = parseProposalBlock(content);
		if (proposal) {
			const validationError = validateProposal(proposal.axis, proposal.value);
			if (validationError) {
				return {
					ok: true,
					analysisMarkdown: content,
					proposal: null,
					llmCallSucceeded: true,
					error: `LLM proposed invalid value: ${validationError}`,
					rawContent: content,
				};
			}
		}
		return {
			ok: true,
			analysisMarkdown: content,
			proposal,
			llmCallSucceeded: true,
			rawContent: content,
		};
	} catch (err) {
		return {
			ok: false,
			analysisMarkdown: "",
			proposal: null,
			llmCallSucceeded: false,
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		clearTimeout(timer);
	}
}

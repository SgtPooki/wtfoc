/**
 * Synthesis + grading runner for the synthesis tier. Maintainer-only.
 *
 * Off by default. Enable with `WTFOC_GROUND_CHECK=1`. Grader config —
 * point these at your own OpenAI-compatible /v1 endpoint:
 *   WTFOC_GRADER_URL   required (e.g. http://localhost:8000/v1)
 *   WTFOC_GRADER_MODEL required (model id served by your endpoint)
 *   WTFOC_GRADER_KEY   optional bearer token
 *
 * The grader MUST be at least as strong as the extractor — peer-review
 * consensus. Validate any candidate grader against the
 * `grader-teeth.test.ts` adversarial fixture (>=80% verdict accuracy)
 * before treating it as production-grade.
 *
 * No multi-grader escalation. Single pinned grader is the Phase 0f cut;
 * disagreement protocols are explicit creep.
 */

import type { Embedder, Reranker, VectorIndex } from "@wtfoc/common";
import { query as searchQuery } from "@wtfoc/search";
import {
	buildGraderUserMessage,
	buildSynthesisUserMessage,
	GRADER_SYSTEM_PROMPT,
	SYNTHESIS_SYSTEM_PROMPT,
} from "./grounding-prompts.js";
import type { LlmUsage, UsageSink } from "./llm-usage.js";

export interface GraderConfig {
	url: string;
	model: string;
	apiKey?: string;
}

export interface GroundingQuery {
	id: string;
	queryText: string;
}

export interface ClaimGrade {
	claim: string;
	verdict: "supported" | "partial" | "unsupported";
	evidence: number[];
}

export interface GroundingPerQuery {
	id: string;
	queryText: string;
	answer: string;
	claims: string[];
	grades: ClaimGrade[];
	supported: number;
	partial: number;
	unsupported: number;
	hallucinationRate: number;
	error?: string;
}

export interface GroundingAggregate {
	graderModel: string;
	queriesGraded: number;
	totalClaims: number;
	totalSupported: number;
	totalPartial: number;
	totalUnsupported: number;
	avgHallucinationRate: number;
}

export interface GroundingResult {
	perQuery: GroundingPerQuery[];
	aggregate: GroundingAggregate;
}

interface ChatCompletionRequest {
	systemPrompt: string;
	userMessage: string;
	model: string;
}

async function chatCompletion(
	endpoint: GraderConfig,
	req: ChatCompletionRequest,
	usageSink: UsageSink,
	signal?: AbortSignal,
): Promise<{ text: string; usage: LlmUsage }> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;
	const url = `${endpoint.url.replace(/\/+$/, "")}/chat/completions`;
	const t0 = performance.now();
	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: req.model,
			messages: [
				{ role: "system", content: req.systemPrompt },
				{ role: "user", content: req.userMessage },
			],
			temperature: 0,
		}),
		signal,
	});
	if (!response.ok) {
		throw new Error(`grounding endpoint ${url}: HTTP ${response.status} — ${await response.text()}`);
	}
	const json = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
		usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
		model?: string;
	};
	const text = json.choices?.[0]?.message?.content ?? "";
	const usage: LlmUsage = {
		requestModelId: req.model,
		providerResponseModelId: json.model,
		promptTokens: json.usage?.prompt_tokens,
		completionTokens: json.usage?.completion_tokens,
		totalTokens: json.usage?.total_tokens,
		durationMs: performance.now() - t0,
	};
	usageSink(usage);
	return { text, usage };
}

function extractJson(text: string): unknown {
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) throw new Error("no JSON object in response");
	return JSON.parse(match[0]);
}

function parseSynthesisResponse(text: string): { answer: string; claims: string[] } {
	const parsed = extractJson(text) as { answer?: unknown; claims?: unknown };
	const answer = typeof parsed.answer === "string" ? parsed.answer : "";
	const claims =
		Array.isArray(parsed.claims) && parsed.claims.every((c) => typeof c === "string")
			? (parsed.claims as string[])
			: [];
	return { answer, claims };
}

function parseGraderResponse(text: string, claims: string[]): ClaimGrade[] {
	const parsed = extractJson(text) as { grades?: unknown };
	if (!Array.isArray(parsed.grades)) return [];
	const grades: ClaimGrade[] = [];
	for (const g of parsed.grades) {
		const item = g as { claim?: unknown; verdict?: unknown; evidence?: unknown };
		const verdict =
			item.verdict === "supported" || item.verdict === "partial" || item.verdict === "unsupported"
				? item.verdict
				: "unsupported";
		const evidence = Array.isArray(item.evidence)
			? item.evidence.filter((n): n is number => typeof n === "number")
			: [];
		const claim = typeof item.claim === "string" ? item.claim : "";
		grades.push({ claim, verdict, evidence });
	}
	// Pad missing grades with "unsupported" so a grader that returns
	// fewer rows than claims is conservatively counted as worst-case.
	while (grades.length < claims.length) {
		grades.push({ claim: claims[grades.length] ?? "", verdict: "unsupported", evidence: [] });
	}
	return grades.slice(0, claims.length);
}

/**
 * Standalone grader call. Takes a claim list + the same evidence the
 * synthesizer saw, returns per-claim verdicts. Exposed for adversarial
 * grader-teeth testing (peer-review review-of-review batch): inject
 * deliberately-wrong claims, verify the grader catches them. If a
 * grader cannot reliably fail planted hallucinations, the
 * hallucinationRate metric is a vanity number.
 */
export async function gradeClaims(input: {
	claims: string[];
	evidence: ReadonlyArray<{ source: string; content: string }>;
	grader: GraderConfig;
	usageSink: UsageSink;
	signal?: AbortSignal;
}): Promise<ClaimGrade[]> {
	if (input.claims.length === 0) return [];
	const res = await chatCompletion(
		input.grader,
		{
			model: input.grader.model,
			systemPrompt: GRADER_SYSTEM_PROMPT,
			userMessage: buildGraderUserMessage(input.claims, input.evidence),
		},
		input.usageSink,
		input.signal,
	);
	return parseGraderResponse(res.text, input.claims);
}

export interface RunGroundingInput {
	queries: GroundingQuery[];
	synthesizer: GraderConfig;
	grader: GraderConfig;
	embedder: Embedder;
	vectorIndex: VectorIndex;
	reranker?: Reranker;
	topK: number;
	synthesizerUsageSink: UsageSink;
	graderUsageSink: UsageSink;
	signal?: AbortSignal;
}

export async function runGrounding(input: RunGroundingInput): Promise<GroundingResult> {
	const perQuery: GroundingPerQuery[] = [];
	for (const q of input.queries) {
		try {
			const result = await searchQuery(q.queryText, input.embedder, input.vectorIndex, {
				topK: input.topK,
				signal: input.signal,
				reranker: input.reranker,
			});
			const evidence = result.results.map((r) => ({
				source: r.source,
				content: r.content ?? "",
			}));

			const synthRes = await chatCompletion(
				input.synthesizer,
				{
					model: input.synthesizer.model,
					systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
					userMessage: buildSynthesisUserMessage(q.queryText, evidence),
				},
				input.synthesizerUsageSink,
				input.signal,
			);
			const { answer, claims } = parseSynthesisResponse(synthRes.text);

			const grades = await gradeClaims({
				claims,
				evidence,
				grader: input.grader,
				usageSink: input.graderUsageSink,
				signal: input.signal,
			});

			const supported = grades.filter((g) => g.verdict === "supported").length;
			const partial = grades.filter((g) => g.verdict === "partial").length;
			const unsupported = grades.filter((g) => g.verdict === "unsupported").length;
			const total = grades.length;
			const hallucinationRate = total > 0 ? unsupported / total : 0;

			perQuery.push({
				id: q.id,
				queryText: q.queryText,
				answer,
				claims,
				grades,
				supported,
				partial,
				unsupported,
				hallucinationRate,
			});
		} catch (err) {
			perQuery.push({
				id: q.id,
				queryText: q.queryText,
				answer: "",
				claims: [],
				grades: [],
				supported: 0,
				partial: 0,
				unsupported: 0,
				hallucinationRate: 0,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const completed = perQuery.filter((p) => !p.error);
	const totalClaims = completed.reduce((acc, p) => acc + p.grades.length, 0);
	const totalSupported = completed.reduce((acc, p) => acc + p.supported, 0);
	const totalPartial = completed.reduce((acc, p) => acc + p.partial, 0);
	const totalUnsupported = completed.reduce((acc, p) => acc + p.unsupported, 0);
	const avgHallucinationRate =
		completed.length > 0
			? completed.reduce((acc, p) => acc + p.hallucinationRate, 0) / completed.length
			: 0;

	return {
		perQuery,
		aggregate: {
			graderModel: input.grader.model,
			queriesGraded: completed.length,
			totalClaims,
			totalSupported,
			totalPartial,
			totalUnsupported,
			avgHallucinationRate,
		},
	};
}

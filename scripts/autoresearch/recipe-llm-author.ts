/**
 * Live LLM author for the gold-query recipe (#344 step 2c).
 *
 * Replaces `stubAuthor` from step 2b with a real call to the homelab
 * patch-llm endpoint. The LLM receives:
 *
 *   - The template's intent (NOT exampleSurface — that primes phrasing).
 *   - The sampled artifact's id, source type, and optional excerpt.
 *   - The applicable corpus id (for `applicableCorpora` on the draft).
 *   - A strict JSON schema describing the required output shape.
 *
 * It returns one `CandidateQuery` per call. The driver (recipe-author)
 * loops over (sample, template) pairs and accumulates candidates.
 *
 * Out of scope this PR (step 2d):
 *   - Segment-content loading (artifact excerpts will replace `excerpt`
 *     placeholder once the segment-loader lands).
 *   - Adversarial filter wiring against the live `query()` retriever.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/344
 */

import { createHash } from "node:crypto";
import type { CandidateQuery, GoldQuery, QueryTemplate, RecipeSample } from "@wtfoc/search";

export const DEFAULT_AUTHOR_LLM_URL = "http://127.0.0.1:4523/v1";
export const DEFAULT_AUTHOR_LLM_MODEL = "haiku";

/**
 * Minimal fetch surface this module relies on. Avoids forcing tests to
 * cast through `typeof fetch` or fabricate full `Response` objects.
 */
export type FetchLike = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{
	ok: boolean;
	status: number;
	text: () => Promise<string>;
	json: () => Promise<unknown>;
}>;

export interface AuthorContext {
	collectionId: string;
	llmUrl?: string;
	llmModel?: string;
	llmApiKey?: string;
	timeoutMs?: number;
	fetchFn?: FetchLike;
	/** Optional content excerpt for the artifact. Step-2d wires this from segments. */
	excerpt?: string;
}

function makeCandidateId(templateId: string, artifactId: string): string {
	const fp = createHash("sha1").update(`${templateId}::${artifactId}`).digest("hex").slice(0, 12);
	return `${templateId}__${fp}`;
}

export interface AuthorResult {
	ok: boolean;
	candidate?: CandidateQuery;
	error?: string;
	rawContent?: string;
}

const SYSTEM_PROMPT = `You are an autoresearch agent for a retrieval system called wtfoc. Your job: author ONE high-quality gold-standard query for a retrieval/trace evaluation.

You are given a query template (intent only, no surface phrasing) and a sampled artifact from the corpus. Author a query whose answer ABSOLUTELY REQUIRES retrieving the sampled artifact, but is NOT trivially solvable by a vector search alone.

Hard constraints on the query you author:
- Phrase the question abstractly (no repo names, no file paths, no issue numbers verbatim).
- Do NOT include any words that appear in the sampled artifact's id verbatim.
- The query must be answerable by a maintainer who knows the corpus — not by lookup luck.
- One query per call. No alternatives.

OUTPUT FORMAT (strict JSON, no prose):

\`\`\`json
{
  "query": "<the abstract question>",
  "acceptableAnswerFacts": [
    "<one factual claim a correct answer should support>",
    "<another, optional>"
  ],
  "rationale": "<one sentence on why this query exercises the trace engine, not vector lookup>"
}
\`\`\`

Do not emit markdown around the JSON. Do not add fields. Do not nest under wrappers.`;

interface LlmDraft {
	query: string;
	acceptableAnswerFacts?: string[];
	rationale?: string;
}

interface OpenAIChatCompletionResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

function buildUserPrompt(
	template: QueryTemplate,
	sample: RecipeSample,
	excerpt: string | undefined,
): string {
	return `## Template intent
${template.intent}

Query type: ${template.queryType}
Difficulty floor: ${template.difficulty}

## Sampled artifact
artifactId: ${sample.artifact.artifactId}
sourceType: ${sample.artifact.sourceType}
edgeType: ${sample.stratum.edgeType ?? "none"}
rarity: ${sample.stratum.rarity}
${excerpt ? `\n### Excerpt\n${excerpt.slice(0, 4000)}` : ""}

Author one query meeting the constraints in the system prompt.`;
}

function parseJsonBlock(content: string): LlmDraft | null {
	// Try to extract a JSON object — model may wrap in fences despite the
	// instruction to skip them. Pull the first {...} balanced span.
	const fenced = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
	const raw = fenced?.[1] ?? content.match(/\{[\s\S]*\}/)?.[0];
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as LlmDraft;
		if (typeof parsed.query !== "string" || parsed.query.trim().length === 0) return null;
		parsed.query = parsed.query.trim();
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Author a single CandidateQuery for the given (sample, template) pair via
 * a live LLM call. Returns `{ ok: false, error }` on transport / parse
 * failure so the driver can keep going across the rest of the pairs.
 */
export async function authorCandidate(
	sample: RecipeSample,
	template: QueryTemplate,
	ctx: AuthorContext,
): Promise<AuthorResult> {
	const url = ctx.llmUrl ?? process.env.WTFOC_AUTHOR_LLM_URL ?? DEFAULT_AUTHOR_LLM_URL;
	const model = ctx.llmModel ?? process.env.WTFOC_AUTHOR_LLM_MODEL ?? DEFAULT_AUTHOR_LLM_MODEL;
	const apiKey = ctx.llmApiKey ?? process.env.WTFOC_AUTHOR_LLM_API_KEY ?? "";
	const fetchFn = ctx.fetchFn ?? fetch;
	const timeoutMs = ctx.timeoutMs ?? 60_000;

	const userPrompt = buildUserPrompt(template, sample, ctx.excerpt);
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	let rawContent: string | undefined;
	try {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		const res = await fetchFn(`${url.replace(/\/+$/, "")}/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				temperature: 0.4,
				max_tokens: 600,
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
				error: `LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
			};
		}
		const body = (await res.json()) as OpenAIChatCompletionResponse;
		rawContent = body.choices?.[0]?.message?.content ?? "";
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `LLM call failed: ${msg}` };
	} finally {
		clearTimeout(timer);
	}

	const draft = parseJsonBlock(rawContent ?? "");
	if (!draft) {
		return {
			ok: false,
			error: "LLM response did not contain a parseable JSON object",
			rawContent,
		};
	}

	const acceptableAnswerFacts = Array.isArray(draft.acceptableAnswerFacts)
		? draft.acceptableAnswerFacts
				.filter((f): f is string => typeof f === "string")
				.map((f) => f.trim())
				.filter((f) => f.length > 0)
		: [];
	const goldDraft: Omit<GoldQuery, "id"> & { id?: string } = {
		id: makeCandidateId(template.id, sample.artifact.artifactId),
		authoredFromCollectionId: ctx.collectionId,
		applicableCorpora: [ctx.collectionId],
		query: draft.query,
		queryType: template.queryType,
		difficulty: template.difficulty,
		targetLayerHints: template.targetLayerHints,
		expectedEvidence: [{ artifactId: sample.artifact.artifactId, required: true }],
		acceptableAnswerFacts,
		requiredSourceTypes: [sample.artifact.sourceType],
		minResults: 1,
		...(draft.rationale ? { migrationNotes: `live-author rationale: ${draft.rationale.trim()}` } : {}),
	};

	return {
		ok: true,
		candidate: { template, stratum: sample.stratum, draft: goldDraft },
		rawContent,
	};
}

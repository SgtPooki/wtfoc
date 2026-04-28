/**
 * Pinned prompts for synthesis + grading. Maintainer-only.
 *
 * Both prompts are hashed into the run config fingerprint so any
 * change re-namespaces caches and invalidates prior fingerprints —
 * grounding metrics are only comparable within a single (synthesis,
 * grader) prompt pair.
 */

export const SYNTHESIS_PROMPT_VERSION = "1.0.0";
export const GRADER_PROMPT_VERSION = "1.0.0";

/**
 * System prompt for the synthesis step. Asks the extractor to answer
 * the user query using ONLY the supplied evidence chunks and to emit a
 * concrete claim list that the grader will later verify span-by-span.
 *
 * Hard constraints in the prompt: respond as one JSON object only,
 * with `answer` and `claims` fields, where claims is an array of
 * short factual assertions. No prose outside the JSON.
 */
export const SYNTHESIS_SYSTEM_PROMPT = `You are an evidence-bounded question answerer.

Rules:
- Use ONLY the evidence chunks provided. If the evidence does not
  support an answer, say so in "answer" and emit an empty "claims".
- "claims" is an array of short, atomic factual statements your answer
  depends on. Each claim must be verifiable against ONE OR MORE of the
  numbered evidence chunks.
- Output exactly one JSON object, no markdown fences, no commentary.

JSON schema:
{
  "answer": "string — concise answer to the user query",
  "claims": ["string", "string", ...]
}`;

/**
 * System prompt for the grader. Each claim is graded against the same
 * evidence the synthesizer saw. Verdict is one of:
 *  - supported: the evidence directly entails the claim
 *  - partial:   the evidence partially supports it; key qualifier missing
 *  - unsupported: no evidence span entails the claim (hallucination)
 *
 * Grader MUST cite the supporting evidence chunk numbers.
 */
export const GRADER_SYSTEM_PROMPT = `You are a citation-grounding grader.

For each claim and the evidence chunks provided, decide whether the
evidence ENTAILS the claim:
- "supported": at least one evidence chunk directly entails the claim.
- "partial":   some support exists but a key qualifier is missing.
- "unsupported": no evidence span entails the claim (hallucination).

Cite supporting evidence chunks by their numbers when you mark
"supported" or "partial".

Output exactly one JSON object, no markdown fences, no commentary.

JSON schema:
{
  "grades": [
    { "claim": "string", "verdict": "supported|partial|unsupported", "evidence": [<chunk number>, ...] },
    ...
  ]
}`;

export function buildSynthesisUserMessage(
	query: string,
	evidence: ReadonlyArray<{ source: string; content: string }>,
): string {
	const chunks = evidence
		.map((e, i) => `[${i + 1}] (${e.source})\n${e.content.slice(0, 1500)}`)
		.join("\n\n");
	return `Question: ${query}\n\nEvidence:\n${chunks}`;
}

export function buildGraderUserMessage(
	claims: string[],
	evidence: ReadonlyArray<{ source: string; content: string }>,
): string {
	const chunks = evidence
		.map((e, i) => `[${i + 1}] (${e.source})\n${e.content.slice(0, 1500)}`)
		.join("\n\n");
	const numbered = claims.map((c, i) => `${i + 1}. ${c}`).join("\n");
	return `Claims:\n${numbered}\n\nEvidence:\n${chunks}`;
}

import type { Chunk } from "@wtfoc/common";
import type { ChatMessage } from "./llm-client.js";

const SYSTEM_PROMPT = `You are an edge extractor for a cross-source knowledge graph. Your input is one or more text chunks from arbitrary sources (code, issues, PRs, chat, docs, web pages). Your job is to propose directed relationships that a human could verify from the text.

Output: a single JSON array of objects. Each object MUST match this shape:
{
  "type": string,
  "sourceId": string,
  "targetType": string,
  "targetId": string,
  "evidence": string,
  "confidence": number
}

IMPORTANT: "type" MUST be one of the following canonical edge types. Do NOT invent new types.

Canonical edge types:
- "references" — artifact explicitly points at another artifact
- "closes" — source claims it resolves an issue/task (fixes, resolves, closes)
- "changes" — PR/commit modifies a file/module/artifact
- "imports" — code imports another module/file/symbol
- "depends-on" — package/module/service requires another
- "implements" — code/PR concretely realizes a requirement, design, spec, or issue
- "documents" — doc/spec/readme explains or covers an implementation artifact
- "tests" — test artifact validates code path, feature, or bugfix
- "addresses" — artifact responds to a problem, concern, bug, or feedback item
- "discusses" — discussion artifact is substantively about a feature/issue/PR/topic
- "authored-by" — person created the artifact
- "reviewed-by" — person reviewed the artifact

Definitions:
- sourceId: The chunk identifier provided in the input. Copy it exactly.
- targetType: What the targetId denotes (e.g. "issue", "file", "person", "pr", "concept", "document"). Prefer specific types over "concept" when the text makes it clear.
- targetId: A stable identifier. Prefer explicit IDs from the text (URLs, issue numbers with repo context, file paths, person handles). If none exists, use a short canonical phrase (lowercase, hyphenated). Never use vague targets like "it" or "this". Targets MUST be specific enough for a human to look up.
- evidence: One or two sentences that QUOTE or closely paraphrase the source chunk. Must be sufficient for a human to confirm the edge.
- confidence: A number between 0.3 and 0.8 inclusive. Use lower values when inference is required. Never exceed 0.8.

Rules:
1) Only emit edges you can justify with evidence from the provided chunk(s).
2) Prefer precision over quantity: fewer high-quality edges beat many weak ones.
3) Do not duplicate the same relationship with different wording.
4) Do not extract edges that regex would catch (e.g. "#123", GitHub URLs, Jira keys).
5) Focus on semantic relationships: implementation, design, discussion, documentation, testing, and people relationships.
6) If the text is purely factual listing with no relational claim, return [].
7) Do not include commentary outside the JSON array.
8) Every targetId should be resolvable — prefer file paths, issue numbers, PR numbers, and person handles over abstract concepts.`;

const FEW_SHOT_EXAMPLES: ChatMessage[] = [
	// Example 1: Engineering context — implements + authored-by
	{
		role: "user",
		content: JSON.stringify({
			chunk_id: "chunk-001",
			source_type: "github-pr",
			source: "owner/repo#42",
			text: "This PR implements the caching layer from the architecture RFC that @alice proposed. It addresses the performance regression discussed in the #backend Slack channel.",
		}),
	},
	{
		role: "assistant",
		content: JSON.stringify([
			{
				type: "implements",
				sourceId: "chunk-001",
				targetType: "document",
				targetId: "architecture-rfc-caching-layer",
				evidence: '"implements the caching layer from the architecture RFC"',
				confidence: 0.8,
			},
			{
				type: "addresses",
				sourceId: "chunk-001",
				targetType: "issue",
				targetId: "performance-regression",
				evidence: '"addresses the performance regression discussed in the #backend Slack channel"',
				confidence: 0.7,
			},
		]),
	},
	// Example 2: Discussion context — discusses + depends-on
	{
		role: "user",
		content: JSON.stringify({
			chunk_id: "chunk-002",
			source_type: "slack-message",
			source: "#engineering",
			text: "The auth rewrite depends on the new session store being deployed first. @bob is working on the migration plan in issue #87.",
		}),
	},
	{
		role: "assistant",
		content: JSON.stringify([
			{
				type: "depends-on",
				sourceId: "chunk-002",
				targetType: "issue",
				targetId: "#87",
				evidence:
					'"depends on the new session store" and "@bob is working on the migration plan in issue #87"',
				confidence: 0.7,
			},
			{
				type: "discusses",
				sourceId: "chunk-002",
				targetType: "concept",
				targetId: "auth-rewrite",
				evidence: '"The auth rewrite depends on the new session store being deployed first"',
				confidence: 0.6,
			},
		]),
	},
	// Example 3: Documentation — documents + references
	{
		role: "user",
		content: JSON.stringify({
			chunk_id: "chunk-003",
			source_type: "markdown",
			source: "owner/repo/docs/api.md",
			text: "## Authentication API\n\nThe /auth/token endpoint is implemented in src/auth/handler.ts. See RFC 6749 for the OAuth 2.0 spec.",
		}),
	},
	{
		role: "assistant",
		content: JSON.stringify([
			{
				type: "documents",
				sourceId: "chunk-003",
				targetType: "file",
				targetId: "src/auth/handler.ts",
				evidence: '"The /auth/token endpoint is implemented in src/auth/handler.ts"',
				confidence: 0.8,
			},
		]),
	},
	// Example 4: No edges
	{
		role: "user",
		content: JSON.stringify({
			chunk_id: "chunk-004",
			source_type: "slack-message",
			source: "#general",
			text: "Tuesday.",
		}),
	},
	{
		role: "assistant",
		content: "[]",
	},
];

/**
 * Build chat messages for edge extraction from a batch of chunks.
 */
export function buildExtractionMessages(chunks: Chunk[]): ChatMessage[] {
	const messages: ChatMessage[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		...FEW_SHOT_EXAMPLES,
	];

	const input = chunks.map((chunk) => ({
		chunk_id: chunk.id,
		source_type: chunk.sourceType,
		source: chunk.source,
		text: chunk.content,
	}));

	messages.push({ role: "user", content: JSON.stringify(input) });

	return messages;
}

/**
 * Rough token count estimate (4 chars ≈ 1 token).
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Estimate the token overhead of the extraction prompt (system + few-shot).
 * This is the fixed cost per LLM call before any chunk content is added.
 */
export function estimatePromptOverhead(): number {
	let total = estimateTokens(SYSTEM_PROMPT);
	for (const msg of FEW_SHOT_EXAMPLES) {
		total += estimateTokens(msg.content);
	}
	return total;
}

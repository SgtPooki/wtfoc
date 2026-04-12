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

Definitions:
- type: A short relation label (lowercase kebab-case). Common types include: references, closes, changes, imports, depends-on, implements, documents, tests, addresses, discusses, authored-by, reviewed-by, part-of, blocks, cites, announces, caused-by. Use whatever label best describes the relationship. Non-standard labels are accepted and normalized downstream.
- sourceId: The chunk identifier provided in the input. Copy it exactly.
- targetType: What kind of thing the targetId denotes (e.g. issue, file, person, pr, concept, document, package, url, organization, event). Use the most specific type the text supports.
- targetId: A stable identifier string. Prefer explicit IDs from the text (URLs, DOIs, issue numbers with repo context, file paths, @mentions). If none exists, use a short canonical phrase (lowercase, hyphenated) that uniquely picks out the entity. Never use vague targets like "it" or "this".
- evidence: One or two sentences that QUOTE or closely paraphrase the source chunk. This must be sufficient for a human to confirm the edge without guessing. If you cannot cite supporting text, omit the edge.
- confidence: A number between 0.3 and 0.8 inclusive. Use lower values when inference is required or identifiers are implicit. Never exceed 0.8 for LLM-proposed edges.

Rules:
1) Only emit edges you can justify with evidence from the provided chunk(s).
2) Prefer precision over quantity: fewer high-quality edges beat many weak ones.
3) Do not duplicate the same relationship with different wording.
4) Extract ALL meaningful relationships you find, including explicit references and mentions. Duplicates with pattern-based extractors are resolved downstream.
5) Focus on semantic relationships: design discussions, implementation links, person mentions, concept references, dependencies, documentation links, testing relationships.
6) If the text is purely factual listing with no relational claim, return [].
7) Do not include commentary outside the JSON array.`;

const FEW_SHOT_EXAMPLES: ChatMessage[] = [
	// Example 1: Engineering PR with multiple relationship types
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
				type: "authored-by",
				sourceId: "chunk-001",
				targetType: "person",
				targetId: "@alice",
				evidence: '"@alice proposed" the architecture RFC',
				confidence: 0.6,
			},
			{
				type: "addresses",
				sourceId: "chunk-001",
				targetType: "concept",
				targetId: "performance-regression",
				evidence: '"addresses the performance regression discussed in the #backend Slack channel"',
				confidence: 0.7,
			},
		]),
	},
	// Example 2: Discussion with dependencies and people
	{
		role: "user",
		content: JSON.stringify({
			chunk_id: "chunk-002",
			source_type: "slack-message",
			source: "#engineering",
			text: "The auth rewrite depends on the new session store being deployed first. @bob is working on the migration plan in issue #87. We should also update the API docs.",
		}),
	},
	{
		role: "assistant",
		content: JSON.stringify([
			{
				type: "depends-on",
				sourceId: "chunk-002",
				targetType: "concept",
				targetId: "session-store-deployment",
				evidence: '"The auth rewrite depends on the new session store being deployed first"',
				confidence: 0.7,
			},
			{
				type: "discusses",
				sourceId: "chunk-002",
				targetType: "concept",
				targetId: "auth-rewrite",
				evidence: '"The auth rewrite depends on the new session store"',
				confidence: 0.7,
			},
			{
				type: "authored-by",
				sourceId: "chunk-002",
				targetType: "person",
				targetId: "@bob",
				evidence: '"@bob is working on the migration plan"',
				confidence: 0.7,
			},
		]),
	},
	// Example 3: Documentation with references
	{
		role: "user",
		content: JSON.stringify({
			chunk_id: "chunk-003",
			source_type: "markdown",
			source: "owner/repo/docs/api.md",
			text: "## Authentication API\n\nThe /auth/token endpoint is implemented in src/auth/handler.ts. See RFC 6749 for the OAuth 2.0 spec. Tests are in src/auth/__tests__/handler.test.ts.",
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
			{
				type: "references",
				sourceId: "chunk-003",
				targetType: "document",
				targetId: "RFC 6749",
				evidence: '"See RFC 6749 for the OAuth 2.0 spec"',
				confidence: 0.8,
			},
			{
				type: "tests",
				sourceId: "chunk-003",
				targetType: "file",
				targetId: "src/auth/__tests__/handler.test.ts",
				evidence: '"Tests are in src/auth/__tests__/handler.test.ts"',
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

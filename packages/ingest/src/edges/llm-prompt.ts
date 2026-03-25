import type { Chunk } from "@wtfoc/common";
import type { ChatMessage } from "./llm-client.js";

const SYSTEM_PROMPT = `You are an edge extractor for a cross-source knowledge graph. Your input is one or more text chunks from arbitrary sources (e.g. chat, email, forums, news, documentation, papers, code, tickets, web pages, transcripts, PDFs). Your job is to propose directed relationships that a human could verify from the text.

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
- type: A short relation label describing how the source chunk connects to the target (use lowercase kebab-case when multi-word, e.g. "related-to", "authored-by"). Use domain-specific relation names when the text clearly supports them (e.g. "cites", "announces", "schedules"). Do not invent a closed list; prefer clarity over novelty.
- sourceId: The chunk identifier provided in the input for the text you are reasoning over. Copy it exactly.
- targetType: What kind of thing the targetId denotes (e.g. person, organization, concept, topic, url, paper, article, event, file, repository, issue, message, thread, document). If unclear, use "concept" or "topic". Do not use source-brand names as types unless they are the best descriptor.
- targetId: A stable identifier string. Prefer explicit IDs from the text (URLs, DOIs, issue numbers with repo context, ticket keys, arXiv ids). If none exists, use a short canonical phrase (lowercase, hyphenated) that uniquely picks out the entity in-context. Never use vague targets like "it" or "this".
- evidence: One or two sentences that QUOTE or closely paraphrase the source chunk. This must be sufficient for a human to confirm the edge without guessing. If you cannot cite supporting text, omit the edge.
- confidence: A number between 0.3 and 0.8 inclusive. Use lower values when inference is required or identifiers are implicit. Never exceed 0.8 for LLM-proposed edges.

Rules:
1) Only emit edges you can justify with evidence from the provided chunk(s).
2) Prefer precision over quantity: fewer high-quality edges beat many weak ones.
3) Do not duplicate the same relationship with different wording.
4) Do not extract edges that simple regex patterns would already catch (e.g. "#123", "owner/repo#456", GitHub URLs, Jira keys like "PROJ-123").
5) Focus on semantic relationships that patterns miss: design discussions, implementation relationships, person mentions, concept references, citations, organizational relationships.
6) If the text is purely factual listing with no relational claim, return [].
7) Do not include commentary outside the JSON array.

Common relation patterns (examples, not limits):
- Linking entities: mentions, discusses, describes, authored-by, published-by, part-of, located-in, occurred-at, related-to.
- Causal or stance: causes, supports, contradicts, refutes, recommends-against.
- Artifacts: references, cites, links-to, summarizes, quotes.
- Work tracking (when content is engineering/product): implements, closes, blocks, depends-on, fixes.`;

const FEW_SHOT_EXAMPLES: ChatMessage[] = [
	// Example 1: Engineering context
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
				targetType: "concept",
				targetId: "architecture-rfc-caching-layer",
				evidence: '"implements the caching layer from the architecture RFC"',
				confidence: 0.8,
			},
			{
				type: "mentions",
				sourceId: "chunk-001",
				targetType: "person",
				targetId: "@alice",
				evidence: '"@alice proposed"',
				confidence: 0.7,
			},
		]),
	},
	// Example 2: Non-software context (news/meeting)
	{
		role: "user",
		content: JSON.stringify({
			chunk_id: "chunk-002",
			source_type: "document",
			source: "meeting-notes-2024-03",
			text: "Maya said the launch depends on legal approval from Acme Health. The team plans to announce at the April partner summit.",
		}),
	},
	{
		role: "assistant",
		content: JSON.stringify([
			{
				type: "depends-on",
				sourceId: "chunk-002",
				targetType: "organization",
				targetId: "acme-health",
				evidence: '"the launch depends on legal approval from Acme Health"',
				confidence: 0.7,
			},
			{
				type: "announced-at",
				sourceId: "chunk-002",
				targetType: "event",
				targetId: "april-partner-summit",
				evidence: '"announce at the April partner summit"',
				confidence: 0.6,
			},
		]),
	},
	// Example 3: Research context
	{
		role: "user",
		content: JSON.stringify({
			chunk_id: "chunk-003",
			source_type: "web-page",
			source: "arxiv.org/abs/2301.00001",
			text: "Following Vaswani et al. (2017), we use multi-head attention; see arXiv:1706.03762.",
		}),
	},
	{
		role: "assistant",
		content: JSON.stringify([
			{
				type: "cites",
				sourceId: "chunk-003",
				targetType: "paper",
				targetId: "arxiv:1706.03762",
				evidence: '"Following Vaswani et al. (2017)" and "arXiv:1706.03762"',
				confidence: 0.7,
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

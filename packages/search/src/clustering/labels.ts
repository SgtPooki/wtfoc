/**
 * Label extraction for theme clusters.
 * Extracts first 5-7 meaningful words from the top exemplar,
 * filtered of common stop words. No TF-IDF.
 */

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"but",
	"by",
	"do",
	"for",
	"from",
	"had",
	"has",
	"have",
	"he",
	"her",
	"his",
	"how",
	"i",
	"if",
	"in",
	"into",
	"is",
	"it",
	"its",
	"just",
	"me",
	"my",
	"no",
	"not",
	"of",
	"on",
	"or",
	"our",
	"out",
	"so",
	"some",
	"than",
	"that",
	"the",
	"their",
	"them",
	"then",
	"there",
	"these",
	"they",
	"this",
	"to",
	"up",
	"us",
	"was",
	"we",
	"were",
	"what",
	"when",
	"which",
	"who",
	"will",
	"with",
	"would",
	"you",
	"your",
]);

const MIN_WORDS = 5;
const MAX_WORDS = 7;

/**
 * Extract a human-readable label from exemplar content.
 * Takes the first 5-7 meaningful (non-stop) words from the content.
 */
export function extractLabel(content: string): string {
	// Collapse whitespace, strip markdown/code fences, take first line-ish
	const cleaned = content
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/[#*_~>|[\](){}]/g, " ")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	const words = cleaned.split(" ").filter((w) => w.length > 0);
	const meaningful: string[] = [];

	for (const word of words) {
		if (meaningful.length >= MAX_WORDS) break;
		const lower = word.toLowerCase().replace(/[^a-z0-9-]/g, "");
		if (lower.length === 0) continue;
		if (STOP_WORDS.has(lower)) continue;
		meaningful.push(word.replace(/[^a-zA-Z0-9-]/g, ""));
	}

	if (meaningful.length < MIN_WORDS) {
		// Fall back: take any words up to MAX_WORDS
		const fallback = words
			.slice(0, MAX_WORDS)
			.map((w) => w.replace(/[^a-zA-Z0-9-]/g, ""))
			.filter((w) => w.length > 0);
		return fallback.join(" ") || "unlabelled cluster";
	}

	return meaningful.join(" ");
}

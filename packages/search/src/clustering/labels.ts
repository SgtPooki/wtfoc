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
 * Returns true if content is mostly code/markup (code fences, HTML tags, etc.)
 */
export function isCodeHeavy(content: string): boolean {
	const codePattern = /^```|^<[a-z]|^\s*\{|^\s*import |^\s*export |^\s*const |^\s*function /m;
	const codeBlocks = (content.match(/```[\s\S]*?```/g) ?? []).join("").length;
	const htmlTags = (content.match(/<[^>]+>/g) ?? []).join("").length;
	const total = content.length;
	if (total === 0) return true;
	return codePattern.test(content.slice(0, 50)) || (codeBlocks + htmlTags) / total > 0.5;
}

/**
 * Extract a human-readable label from exemplar content.
 * Takes the first 5-7 meaningful (non-stop) words from the content.
 */
export function extractLabel(content: string): string {
	const cleaned = content
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&[a-z]+;/g, " ")
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
		const fallback = words
			.slice(0, MAX_WORDS)
			.map((w) => w.replace(/[^a-zA-Z0-9-]/g, ""))
			.filter((w) => w.length > 0);
		return fallback.join(" ") || "unlabelled cluster";
	}

	return meaningful.join(" ");
}

/**
 * Try multiple content candidates for a label, preferring non-code content.
 */
export function extractLabelFromCandidates(candidates: string[]): string {
	// Try non-code candidates first
	for (const content of candidates) {
		if (!isCodeHeavy(content)) {
			const label = extractLabel(content);
			if (label !== "unlabelled cluster") return label;
		}
	}
	// Fall back to any candidate
	for (const content of candidates) {
		const label = extractLabel(content);
		if (label !== "unlabelled cluster") return label;
	}
	return "unlabelled cluster";
}

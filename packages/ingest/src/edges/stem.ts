/**
 * Lightweight English suffix stripper for concept grounding.
 *
 * NOT a full stemmer — just strips common suffixes so that morphological
 * variants (deployment/deployed, collision/collide) share a common stem.
 * Used by Gate 7 in edge-validator.ts to match concept slugs against evidence.
 */

/** Doubled consonants that collapse when removing -ing/-ed (running → run, stopped → stop) */
const DOUBLED_CONSONANTS = new Set([
	"bb",
	"cc",
	"dd",
	"ff",
	"gg",
	"ll",
	"mm",
	"nn",
	"pp",
	"rr",
	"ss",
	"tt",
	"zz",
]);

const MIN_STEM_LENGTH = 3;

/**
 * Suffixes ordered longest-first so we strip the most specific match.
 * Each entry: [suffix, extra chars to also remove after stripping]
 */
const SUFFIXES = [
	"ization",
	"isation",
	"tion",
	"sion",
	"ment",
	"ness",
	"ible",
	"able",
	"ance",
	"ence",
	"ize",
	"ise",
	"ing",
	"ity",
	"ous",
	"est",
	"al",
	"ly",
	"er",
	"ed",
];

/**
 * Strip common English suffixes from a word to produce a rough stem.
 *
 * @param word - The word to stem (case-insensitive, result is lowercased)
 * @returns The stemmed word, or the original (lowercased) if no suffix matched
 *          or stripping would produce a stem shorter than 3 characters.
 */
export function stripSuffix(word: string): string {
	const w = word.toLowerCase();

	for (const suffix of SUFFIXES) {
		if (!w.endsWith(suffix)) continue;

		let stem = w.slice(0, -suffix.length);

		// Handle doubled consonants for -ing and -ed
		// e.g. "running" → "runn" → "run", "stopped" → "stopp" → "stop"
		if ((suffix === "ing" || suffix === "ed") && stem.length >= MIN_STEM_LENGTH) {
			const lastTwo = stem.slice(-2);
			if (DOUBLED_CONSONANTS.has(lastTwo)) {
				stem = stem.slice(0, -1);
			}
		}

		if (stem.length >= MIN_STEM_LENGTH) {
			return stem;
		}
	}

	return w;
}

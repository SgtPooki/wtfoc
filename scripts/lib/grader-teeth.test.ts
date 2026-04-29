import { describe, expect, it } from "vitest";
import { gradeClaims } from "./grounding-runner.js";

/**
 * Grader-teeth test (#311 peer-review review-of-review batch).
 *
 * # Validated graders (verdict-accuracy floor 0.80, 10-case fixture)
 *
 *   ollama qwen3:14b ........... PASS (2026-04-29)
 *
 * Untested:
 *   ollama qwen3.6:27b-nvfp4 ... TIMED OUT under default settings;
 *     Metal GPU timeouts on the host machine. Re-run with longer
 *     ollama keep-alive or a less-loaded session before treating
 *     this model as the default grader.
 *   vllm qwen3.6-27b ............ endpoint behind cloudflare returned
 *     schema-shaped responses, not real completions, when polled
 *     2026-04-29; not yet validated.
 *
 * Maintainer: when adding a grader to this list, run with
 *   WTFOC_GRADER_TEETH=1 WTFOC_GRADER_URL=... WTFOC_GRADER_MODEL=...
 * and update the validated-graders comment with the date.
 *
 * Phase 0f's grading pipeline produced 0% hallucination on a 6-query
 * sample — too clean to be informative. Reviewers flagged this as
 * either (a) a vanity metric (grader too soft to catch real lies) or
 * (b) an artifact of evidence-bound synthesis prompts hedging to safe
 * claims. This test cuts through that ambiguity by feeding the
 * grader hand-authored adversarial claims against fixed evidence and
 * asserting the grader hits a verdict-accuracy floor.
 *
 * If the grader cannot reliably fail planted contradictions, the
 * hallucinationRate metric we ship in dogfood reports is a vanity
 * number — Phase 2 ranking variants on it would optimize for nothing.
 *
 * # Why opt-in
 *
 * The test calls a real LLM endpoint (default vLLM at
 * vllm.bt.sgtpooki.com, fallback ollama qwen3.6:27b-nvfp4 on Mac).
 * Real-call latency makes it unsuitable for the default pnpm test
 * loop. Opt in with `WTFOC_GRADER_TEETH=1`. The default-skipped run
 * still type-checks and is flat-failable — the adversarial fixture
 * doubles as documentation of the grader's expected behavior.
 *
 * # The accuracy floor
 *
 * 0.80 (8 of 10 cases) — generous enough that ANN noise on the
 * grader doesn't false-fail us, strict enough that a grader rating
 * ALL claims supported (the v0.1.0 vanity-metric concern) trips it.
 * Gradient: a perfect grader = 1.0, a soft grader = 0.5, an always-
 * unsupported "everything's a hallucination" grader = 0.5 (still
 * fails). Tighten to 0.85 once we have a stronger track record.
 */

const TEETH_ENABLED = process.env.WTFOC_GRADER_TEETH === "1";
const GRADER_URL =
	process.env.WTFOC_GRADER_URL ?? "https://vllm.bt.sgtpooki.com/v1";
const GRADER_MODEL = process.env.WTFOC_GRADER_MODEL ?? "qwen3.6-27b";
const GRADER_KEY = process.env.WTFOC_GRADER_KEY;

interface AdversarialCase {
	claim: string;
	evidence: ReadonlyArray<{ source: string; content: string }>;
	expected: "supported" | "partial" | "unsupported";
	rationale: string;
}

/**
 * 10 hand-authored adversarial claim/evidence pairs. Each pair fixes
 * the evidence and varies the claim's truth wrt that evidence:
 *   - 4 supported (control — grader should mark these supported)
 *   - 3 partial  (key qualifier missing or scope-shifted)
 *   - 3 unsupported (claim contradicts or wholly invents detail)
 *
 * Evidence chunks are deliberately written to look like real corpus
 * content so the grader can't pattern-match on stylistic tells. They
 * are NOT drawn from the live filoz corpus to keep the test stable
 * across re-ingest.
 */
const CASES: AdversarialCase[] = [
	// SUPPORTED (4)
	{
		claim: "The deposit function calls approve before transferring USDFC.",
		evidence: [
			{
				source: "test/payments/deposit.ts",
				content:
					"export async function deposit(amount: bigint) {\n" +
					"  await usdfc.approve(rail, amount);\n" +
					"  await rail.transfer(amount);\n" +
					"}",
			},
		],
		expected: "supported",
		rationale: "Code shows approve() called before transfer().",
	},
	{
		claim: "PieceCID validation rejects CIDs whose multihash is not sha2-256.",
		evidence: [
			{
				source: "test/piece/validate.ts",
				content:
					"function validatePieceCid(cid: CID) {\n" +
					"  if (cid.multihash.code !== sha256.code) {\n" +
					"    throw new Error('PieceCID must use sha2-256');\n" +
					"  }\n" +
					"}",
			},
		],
		expected: "supported",
		rationale: "Code throws on non-sha2-256 multihash.",
	},
	{
		claim:
			"DataSetStatus has at least three states including Active and Terminated.",
		evidence: [
			{
				source: "test/contract/State.sol",
				content:
					"enum DataSetStatus {\n" +
					"    Initialized,\n" +
					"    Active,\n" +
					"    Terminated\n" +
					"}",
			},
		],
		expected: "supported",
		rationale: "Enum lists three states including the two named.",
	},
	{
		claim: "The retry loop sleeps 60 seconds on the first transient failure.",
		evidence: [
			{
				source: "test/retry.ts",
				content:
					"const PROVIDER_ERROR_BASE_DELAY_MS = 60_000;\n" +
					"// On retry: wait base * (attempt + 1) ms\n" +
					"await sleep(PROVIDER_ERROR_BASE_DELAY_MS * (attempt + 1));",
			},
		],
		expected: "supported",
		rationale: "First attempt (n=0) → 60s × 1 = 60s.",
	},

	// PARTIAL (3)
	{
		claim: "PieceCID validation rejects malformed CIDs and emits a structured error event.",
		evidence: [
			{
				source: "test/piece/validate.ts",
				content:
					"function validatePieceCid(cid: CID) {\n" +
					"  if (!cid.multihash) throw new Error('malformed PieceCID');\n" +
					"}",
			},
		],
		expected: "partial",
		rationale:
			"Evidence supports rejection; says nothing about a structured error event.",
	},
	{
		claim:
			"The deposit function calls approve, transfers USDFC, and emits a Deposited event.",
		evidence: [
			{
				source: "test/payments/deposit.ts",
				content:
					"export async function deposit(amount: bigint) {\n" +
					"  await usdfc.approve(rail, amount);\n" +
					"  await rail.transfer(amount);\n" +
					"}",
			},
		],
		expected: "partial",
		rationale:
			"Approve + transfer supported; Deposited event not in evidence.",
	},
	{
		claim: "DataSetStatus transitions strictly forward from Initialized to Terminated.",
		evidence: [
			{
				source: "test/contract/State.sol",
				content:
					"enum DataSetStatus {\n" +
					"    Initialized,\n" +
					"    Active,\n" +
					"    Terminated\n" +
					"}",
			},
		],
		expected: "partial",
		rationale:
			"Enum lists states but evidence does NOT specify transition direction.",
	},

	// UNSUPPORTED (3)
	{
		claim: "PieceCID validation accepts CIDs with any multihash code, including sha512.",
		evidence: [
			{
				source: "test/piece/validate.ts",
				content:
					"function validatePieceCid(cid: CID) {\n" +
					"  if (cid.multihash.code !== sha256.code) {\n" +
					"    throw new Error('PieceCID must use sha2-256');\n" +
					"  }\n" +
					"}",
			},
		],
		expected: "unsupported",
		rationale: "Claim directly contradicts evidence (only sha2-256 is accepted).",
	},
	{
		claim: "The deposit function emits a tax-withholding event for jurisdictions in the EU.",
		evidence: [
			{
				source: "test/payments/deposit.ts",
				content:
					"export async function deposit(amount: bigint) {\n" +
					"  await usdfc.approve(rail, amount);\n" +
					"  await rail.transfer(amount);\n" +
					"}",
			},
		],
		expected: "unsupported",
		rationale: "Pure invention; no tax/EU/jurisdiction signal in evidence.",
	},
	{
		claim: "DataSetStatus has exactly five states including Suspended and Migrating.",
		evidence: [
			{
				source: "test/contract/State.sol",
				content:
					"enum DataSetStatus {\n" +
					"    Initialized,\n" +
					"    Active,\n" +
					"    Terminated\n" +
					"}",
			},
		],
		expected: "unsupported",
		rationale:
			"Evidence shows three states; claim invents Suspended and Migrating.",
	},
];

const ACCURACY_FLOOR = 0.8;

describe.skipIf(!TEETH_ENABLED)(
	"grader teeth (#311 review-of-review)",
	() => {
		it(
			`grader hits at least ${ACCURACY_FLOOR * 100}% verdict accuracy on adversarial fixture`,
			async () => {
				let usageCount = 0;
				let correct = 0;
				const wrong: Array<{ idx: number; expected: string; got: string }> = [];

				for (let i = 0; i < CASES.length; i++) {
					const c = CASES[i];
					if (!c) continue;
					const grades = await gradeClaims({
						claims: [c.claim],
						evidence: c.evidence,
						grader: { url: GRADER_URL, model: GRADER_MODEL, apiKey: GRADER_KEY },
						usageSink: () => {
							usageCount++;
						},
					});
					const got = grades[0]?.verdict ?? "unsupported";
					if (got === c.expected) {
						correct++;
					} else {
						wrong.push({ idx: i, expected: c.expected, got });
					}
				}

				const accuracy = correct / CASES.length;
				console.error(
					`grader-teeth: ${correct}/${CASES.length} correct (${(accuracy * 100).toFixed(0)}%); usage calls: ${usageCount}`,
				);
				if (wrong.length > 0) {
					for (const w of wrong) {
						const c = CASES[w.idx];
						console.error(
							`  case ${w.idx} (${c?.expected}): grader returned ${w.got} — claim: ${c?.claim.slice(0, 80)}`,
						);
					}
				}
				expect(accuracy).toBeGreaterThanOrEqual(ACCURACY_FLOOR);
			},
			600_000, // 10 minutes — local LLMs grading 10 claims is slow.
		);
	},
);

// Always-on fixture-shape sanity check so the file isn't dead weight
// when the env flag is off.
describe("grader teeth fixture shape", () => {
	it("has a balanced spread of expected verdicts", () => {
		const counts: Record<string, number> = {};
		for (const c of CASES) counts[c.expected] = (counts[c.expected] ?? 0) + 1;
		expect(counts.supported).toBeGreaterThanOrEqual(3);
		expect(counts.partial).toBeGreaterThanOrEqual(2);
		expect(counts.unsupported).toBeGreaterThanOrEqual(2);
	});

	it("every case has a non-empty claim and at least one evidence chunk", () => {
		for (const c of CASES) {
			expect(c.claim.length).toBeGreaterThan(10);
			expect(c.evidence.length).toBeGreaterThanOrEqual(1);
			for (const e of c.evidence) {
				expect(e.source.length).toBeGreaterThan(0);
				expect(e.content.length).toBeGreaterThan(0);
			}
		}
	});
});

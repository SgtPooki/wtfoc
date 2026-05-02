/**
 * Fixture-expand PR promotion (#360 milestone 1f). Maintainer-only.
 *
 * Given a recipe-pipeline `codegen` blob from `runRecipePipeline`, splice
 * it into `packages/search/src/eval/gold-authored-queries.ts` between the
 * managed-array markers, commit on a fresh branch, and `gh pr create
 * --draft`. Maintainer reviews + merges manually; never silent
 * auto-merge.
 *
 * Hard guardrails (mirrors `promote-via-pr.ts`):
 *
 *   - Only `gold-authored-queries.ts` may be touched. Anything else in
 *     the working tree fails-closed before commit.
 *   - The branch name encodes the proposal id so concurrent runs cannot
 *     collide.
 *   - The splice goes through `spliceAuthoredQueries` (existing
 *     marker-aware helper from #361). If markers are missing, fail-soft
 *     with a `skippedReason` rather than corrupting the file.
 *
 * @see https://github.com/SgtPooki/wtfoc/issues/360
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeExecFileSync as execFileSync } from "../lib/safe-exec.js";
import { spliceAuthoredQueries } from "./recipe-apply.js";

export interface PromoteFixtureInputs {
	/** Stable id for the cycle, used in branch + commit subject. */
	proposalId: string;
	/** Source collection that drove this fixture-expand cycle. */
	collectionId: string;
	/** Codegen blob from `runRecipePipeline`. Splice-ready TS array literal. */
	codegen: string;
	/** Number of new gold queries the codegen carries; for the PR body. */
	keptCount: number;
	/** Top targeted strata for the PR body. */
	targetedStrata: ReadonlyArray<{
		sourceType: string;
		queryType: string;
		artifactsInCorpus: number;
	}>;
	/**
	 * Latest dogfood pass rates for the EXISTING gold-query fixture, for
	 * the PR's "retrieval health check" section. Codex peer-review on
	 * #360 flagged the fixture-drift failure mode: fixture-expand could
	 * mask retrieval regressions if reviewers don't see existing-query
	 * performance alongside new-query coverage. Pass `null` for either
	 * side when a comparable report is not available; the section just
	 * notes the gap.
	 */
	retrievalHealth?: {
		latestPassRate: number | null;
		baselinePassRate: number | null;
		latestSweepId?: string;
		baselineSweepId?: string;
	};
	dryRun?: boolean;
	/** Path to the wtfoc repo root. Defaults to walking up from this file. */
	repoRoot?: string;
	spawnFn?: (cmd: string, args: string[], opts?: { cwd?: string }) => Buffer | string;
}

export interface PromoteFixtureResult {
	prUrl: string | null;
	branch: string;
	fixtureFilePath: string;
	dryRun: boolean;
	skippedReason?: string;
}

const HERE = (() => {
	try {
		return dirname(fileURLToPath(import.meta.url));
	} catch {
		return process.cwd();
	}
})();

function defaultRepoRoot(): string {
	// scripts/autoresearch/promote-fixture-via-pr.ts → repo root is two
	// levels up.
	return resolve(HERE, "..", "..");
}

const FIXTURE_REL_PATH = join(
	"packages",
	"search",
	"src",
	"eval",
	"gold-authored-queries.ts",
);

function git(
	args: string[],
	opts: { cwd: string },
	spawnFn: PromoteFixtureInputs["spawnFn"],
): string {
	const fn = spawnFn ?? execFileSync;
	const out = fn("git", args, { cwd: opts.cwd });
	return typeof out === "string" ? out : out.toString("utf-8");
}

/**
 * Render the "retrieval health" PR section showing existing-fixture
 * pass rate latest vs baseline. Codex peer-review on #360 prescribed
 * this as the mitigation for fixture-drift: if the loop expands the
 * fixture against retrieval weakness, the PR must surface whether
 * existing-query performance regressed in the same window. Returns
 * null when no health data was supplied.
 */
export function renderRetrievalHealthSection(
	health: PromoteFixtureInputs["retrievalHealth"] | undefined,
): string | null {
	if (!health) return null;
	const fmt = (v: number | null): string =>
		v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
	const lines: string[] = [];
	lines.push(`- Latest pass rate: ${fmt(health.latestPassRate)}`);
	lines.push(`- Baseline pass rate: ${fmt(health.baselinePassRate)}`);
	if (
		health.latestPassRate !== null &&
		health.baselinePassRate !== null
	) {
		const delta = health.latestPassRate - health.baselinePassRate;
		const sign = delta >= 0 ? "+" : "";
		lines.push(`- Δ pass rate: ${sign}${(delta * 100).toFixed(1)} pp`);
		if (delta < -0.01) {
			lines.push(
				"- :warning: **Existing-fixture pass rate regressed.** A coverage gap fired alongside a retrieval regression — review with extra care: this PR could be masking a real search bug rather than measuring more.",
			);
		}
	}
	if (health.latestSweepId || health.baselineSweepId) {
		lines.push(
			`- Sweeps: latest=\`${health.latestSweepId ?? "n/a"}\` baseline=\`${health.baselineSweepId ?? "n/a"}\``,
		);
	}
	return lines.join("\n");
}

export async function promoteFixtureViaPr(
	input: PromoteFixtureInputs,
): Promise<PromoteFixtureResult> {
	const repoRoot = input.repoRoot ?? defaultRepoRoot();
	const filePath = join(repoRoot, FIXTURE_REL_PATH);
	if (!existsSync(filePath)) {
		return {
			prUrl: null,
			branch: "",
			fixtureFilePath: filePath,
			dryRun: input.dryRun ?? false,
			skippedReason: `gold-authored-queries.ts not found at ${filePath}`,
		};
	}

	const original = readFileSync(filePath, "utf-8");
	let newSource: string;
	try {
		newSource = spliceAuthoredQueries(original, input.codegen);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			prUrl: null,
			branch: "",
			fixtureFilePath: filePath,
			dryRun: input.dryRun ?? false,
			skippedReason: `splice failed: ${msg.slice(0, 200)}`,
		};
	}
	if (newSource === original) {
		return {
			prUrl: null,
			branch: "",
			fixtureFilePath: filePath,
			dryRun: input.dryRun ?? false,
			skippedReason: "splice produced no diff (codegen already in file?)",
		};
	}

	const branch = `autoresearch/fixture-${input.proposalId}`;

	if (input.dryRun) {
		return {
			prUrl: null,
			branch,
			fixtureFilePath: filePath,
			dryRun: true,
		};
	}

	// Hard guardrail: working tree must be clean OR have only the
	// fixture file modified — never sweep up unrelated work.
	const status = git(
		["status", "--porcelain", "--", FIXTURE_REL_PATH, "."],
		{ cwd: repoRoot },
		input.spawnFn,
	);
	const dirtyLines = status
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	const allowed = (l: string) => l.endsWith(FIXTURE_REL_PATH);
	const stray = dirtyLines.filter((l) => !allowed(l));
	if (stray.length > 0) {
		return {
			prUrl: null,
			branch,
			fixtureFilePath: filePath,
			dryRun: false,
			skippedReason: `working tree has unrelated changes — refusing to commit: ${stray.join("; ")}`,
		};
	}

	git(["checkout", "-b", branch], { cwd: repoRoot }, input.spawnFn);
	writeFileSync(filePath, newSource);
	git(["add", "--", FIXTURE_REL_PATH], { cwd: repoRoot }, input.spawnFn);

	const subject = `feat(autoresearch): expand gold fixture +${input.keptCount} (proposal ${input.proposalId})`;
	const stratumList = input.targetedStrata
		.slice(0, 5)
		.map((s) => `- \`${s.sourceType}/${s.queryType}\` (artifacts=${s.artifactsInCorpus})`)
		.join("\n");
	const healthSection = renderRetrievalHealthSection(input.retrievalHealth);
	const body = [
		"Autoresearch loop expanded the gold-query fixture against under-represented strata in the corpus catalog. Maintainer review required before merge.",
		"",
		`Source collection: \`${input.collectionId}\``,
		`Kept candidates: ${input.keptCount}`,
		"",
		"## Targeted strata",
		"",
		stratumList || "(none)",
		"",
		...(healthSection ? ["## Retrieval health check", "", healthSection, ""] : []),
		"## Review checklist",
		"",
		"- [ ] Each new query is well-formed (no fabricated concepts).",
		"- [ ] Each `expectedEvidence.artifactId` exists in the corpus catalog.",
		"- [ ] Required source types match what the query intent implies.",
		"- [ ] No accidental duplicates of existing `GOLD_STANDARD_QUERIES` ids.",
		"- [ ] Existing-fixture pass rate did not regress in the latest run (see above).",
		"",
		"_Generated by `scripts/autoresearch/recipe-pipeline.ts` → `promote-fixture-via-pr.ts`. See #360._",
	].join("\n");
	git(["commit", "-m", subject, "-m", body], { cwd: repoRoot }, input.spawnFn);

	const fn = input.spawnFn ?? execFileSync;
	fn("git", ["push", "-u", "origin", branch], { cwd: repoRoot });

	const prOut = fn(
		"gh",
		[
			"pr",
			"create",
			"--draft",
			"--title",
			subject,
			"--body",
			body,
			"--label",
			"enhancement",
			"--head",
			branch,
		],
		{ cwd: repoRoot },
	);
	const prText = typeof prOut === "string" ? prOut : prOut.toString("utf-8");
	const prUrl = prText.split("\n").find((l) => l.startsWith("https://")) ?? null;

	return {
		prUrl,
		branch,
		fixtureFilePath: filePath,
		dryRun: false,
	};
}

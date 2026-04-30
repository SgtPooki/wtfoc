#!/usr/bin/env tsx
/**
 * Phase 4 auto-issue creator. Maintainer-only.
 *
 * Reads a DetectionOutcome JSON (from `detect-regression`), groups
 * findings by stable incident key, deduplicates against per-incident
 * state files under `~/.wtfoc/autoresearch/regressions/<key>.json`,
 * and calls `gh issue create` for each new or stale-silenced incident.
 *
 * Stable incident key:
 *   sha256("<variantId>|<corpus>|<findingType>|<metric>|<fingerprintVersion>")
 *
 * Dedupe rules:
 *   - First time seen: file an issue. State file recorded.
 *   - Same key seen within 7 days of last filing: silent skip.
 *   - Same key seen >= 7 days after last filing: re-file with
 *     "Still regressed:" prefix.
 *   - Latest passes (no finding) but state exists: clear state.
 *
 * Usage:
 *   pnpm autoresearch:file-regression-issue \
 *     --findings /path/to/findings.json \
 *     [--dry-run] \
 *     [--silence-days 7]
 *
 * Dry-run prints the proposed issue body to stdout and does NOT touch
 * disk state or call gh. Used in tests + by the maintainer to preview.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DetectionOutcome, Finding } from "./detect-regression.js";

export const DEFAULT_SILENCE_DAYS = 7;

interface IncidentState {
	incidentKey: string;
	variantId: string;
	corpus: string;
	findingType: Finding["type"];
	metric: string;
	fingerprintVersion: number;
	firstSeenAt: string;
	lastNotifiedAt: string;
	issueNumbers: number[];
}

export interface FileIssueDecision {
	action: "create" | "skip" | "clear";
	incidentKey: string;
	finding: Finding;
	reason: string;
	previouslyFiled?: boolean;
	issueNumber?: number;
	body?: string;
	title?: string;
}

export interface FileIssueInputs {
	outcome: DetectionOutcome;
	stateDir: string;
	now?: Date;
	silenceDays?: number;
	dryRun?: boolean;
	createIssue?: (title: string, body: string, labels: string[]) => number;
}

export function incidentKeyFor(finding: Finding): string {
	const raw = `${finding.variantId}|${finding.corpus}|${finding.type}|${finding.metric}|${finding.fingerprintVersion}`;
	return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function statePath(stateDir: string, key: string): string {
	return join(stateDir, `${key}.json`);
}

function loadState(path: string): IncidentState | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as IncidentState;
	} catch {
		return null;
	}
}

function writeState(path: string, state: IncidentState): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, 2));
}

export function buildIssueTitle(finding: Finding, repeatedFiling: boolean): string {
	const prefix = repeatedFiling ? "Still regressed: " : "";
	if (finding.type === "breach") {
		return `${prefix}autoresearch: ${finding.metric} breach on ${finding.variantId} (${finding.corpus})`;
	}
	return `${prefix}autoresearch: regression on ${finding.variantId} ${finding.metric} (${finding.corpus})`;
}

export function buildIssueBody(
	finding: Finding,
	outcome: DetectionOutcome,
	repeatedFiling: boolean,
): string {
	const lines: string[] = [];
	lines.push(`Detected by the autoresearch nightly cron.`);
	lines.push("");
	lines.push("## Identity");
	lines.push(`- variantId: \`${finding.variantId}\``);
	lines.push(`- corpus: \`${finding.corpus}\``);
	lines.push(`- corpusDigest: \`${finding.corpusDigest}\``);
	lines.push(`- runConfigFingerprint: \`${finding.fingerprint}\` (v${finding.fingerprintVersion})`);
	lines.push(`- latestSweepId: \`${finding.latestSweepId}\``);
	lines.push(`- latestLoggedAt: ${finding.latestLoggedAt}`);
	lines.push("");
	lines.push(`## Finding (${finding.type})`);
	lines.push(`- metric: \`${finding.metric}\``);
	if (finding.latestValue !== null && finding.latestValue !== undefined) {
		lines.push(`- latest value: ${finding.latestValue.toFixed(4)}`);
	}
	if (finding.type === "breach" && finding.floor !== undefined) {
		lines.push(`- floor: ${finding.floor.toFixed(4)}`);
		if (finding.latestValue !== null && finding.latestValue !== undefined) {
			lines.push(`- gap: ${(finding.latestValue - finding.floor).toFixed(4)}`);
		}
	}
	if (finding.type === "regression") {
		if (finding.baselineMean !== undefined) {
			lines.push(`- baseline mean: ${finding.baselineMean.toFixed(4)}`);
		}
		if (finding.bootstrapMeanDelta !== undefined) {
			lines.push(
				`- bootstrap meanΔ (old - new): ${finding.bootstrapMeanDelta.toFixed(4)} (≥ 0.04 trip threshold)`,
			);
		}
		if (finding.probBgreaterA !== undefined) {
			lines.push(
				`- bootstrap probBgreaterA (old beats new): ${finding.probBgreaterA.toFixed(4)} (≥ 0.95 trip threshold)`,
			);
		}
		if (finding.baselineSweepIds && finding.baselineSweepIds.length > 0) {
			lines.push(`- baseline sweeps that beat latest: ${finding.baselineSweepIds.join(", ")}`);
		}
	}
	lines.push("");
	lines.push(`> ${finding.reason}`);
	lines.push("");
	lines.push("## Reproduce locally");
	lines.push("");
	lines.push("```bash");
	lines.push(`pnpm autoresearch:sweep <matrix> \\`);
	lines.push(`  --variant-filter ${finding.variantId} \\`);
	lines.push(`  --stage repro`);
	lines.push("```");
	lines.push("");
	lines.push("## Run log");
	lines.push("");
	lines.push("```bash");
	lines.push(
		`grep -F '${finding.latestSweepId}' ~/.wtfoc/autoresearch/runs.jsonl | grep -F '"variantId":"${finding.variantId}"'`,
	);
	lines.push("```");
	if (repeatedFiling) {
		lines.push("");
		lines.push(
			`> Note: the previous incident was filed > silence window ago and is still regressed.`,
		);
	}
	return lines.join("\n");
}

function ghCreateIssue(title: string, body: string, labels: string[]): number {
	const args: string[] = ["issue", "create", "--title", title, "--body", body];
	for (const l of labels) {
		args.push("--label", l);
	}
	const url = execFileSync("gh", args, { encoding: "utf-8" }).trim();
	const m = url.match(/\/issues\/(\d+)$/);
	if (!m) throw new Error(`gh did not return an issue URL: ${url}`);
	return Number.parseInt(m[1] ?? "0", 10);
}

/**
 * Pure decision logic. Returns one decision per finding. The caller
 * persists state and (for create decisions) calls gh.
 */
export function planFilings(input: FileIssueInputs): FileIssueDecision[] {
	const now = input.now ?? new Date();
	const silenceDays = input.silenceDays ?? DEFAULT_SILENCE_DAYS;
	const silenceMs = silenceDays * 24 * 60 * 60 * 1000;
	const decisions: FileIssueDecision[] = [];

	const seenKeys = new Set<string>();
	for (const finding of input.outcome.findings) {
		const key = incidentKeyFor(finding);
		seenKeys.add(key);
		const path = statePath(input.stateDir, key);
		const prior = loadState(path);
		const title = buildIssueTitle(finding, prior !== null);
		const body = buildIssueBody(finding, input.outcome, prior !== null);
		if (!prior) {
			decisions.push({
				action: "create",
				incidentKey: key,
				finding,
				reason: "new incident",
				previouslyFiled: false,
				title,
				body,
			});
			continue;
		}
		const lastNotified = new Date(prior.lastNotifiedAt).getTime();
		const elapsed = now.getTime() - lastNotified;
		if (elapsed < silenceMs) {
			decisions.push({
				action: "skip",
				incidentKey: key,
				finding,
				reason: `silenced — last filed ${Math.floor(elapsed / 86400000)}d ago (< ${silenceDays}d)`,
				previouslyFiled: true,
				...(prior.issueNumbers.length > 0
					? { issueNumber: prior.issueNumbers[prior.issueNumbers.length - 1] }
					: {}),
			});
			continue;
		}
		decisions.push({
			action: "create",
			incidentKey: key,
			finding,
			reason: `re-filing — last filed ${Math.floor(elapsed / 86400000)}d ago (>= ${silenceDays}d)`,
			previouslyFiled: true,
			title,
			body,
		});
	}

	return decisions;
}

interface CliArgs {
	findingsPath: string;
	dryRun: boolean;
	silenceDays: number;
	stateDir: string;
}

function parseArgs(argv: string[]): CliArgs {
	const args = argv.slice(2);
	let findingsPath: string | null = null;
	let dryRun = false;
	let silenceDays = DEFAULT_SILENCE_DAYS;
	const baseDir =
		process.env.WTFOC_AUTORESEARCH_DIR ?? `${process.env.HOME}/.wtfoc/autoresearch`;
	let stateDir = join(baseDir, "regressions");
	for (let i = 0; i < args.length; i++) {
		const a = args[i] ?? "";
		const eat = (): string => {
			const v = args[++i];
			if (!v) throw new Error(`${a} requires a value`);
			return v;
		};
		if (a === "--findings") {
			findingsPath = eat();
			continue;
		}
		if (a.startsWith("--findings=")) {
			findingsPath = a.slice("--findings=".length);
			continue;
		}
		if (a === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (a === "--silence-days") {
			silenceDays = Number.parseInt(eat(), 10);
			continue;
		}
		if (a.startsWith("--silence-days=")) {
			silenceDays = Number.parseInt(a.slice("--silence-days=".length), 10);
			continue;
		}
		if (a === "--state-dir") {
			stateDir = eat();
			continue;
		}
		if (a.startsWith("--state-dir=")) {
			stateDir = a.slice("--state-dir=".length);
			continue;
		}
		throw new Error(`unknown flag: ${a}`);
	}
	if (!findingsPath) throw new Error("usage: --findings <path>");
	return { findingsPath, dryRun, silenceDays, stateDir };
}

async function main(): Promise<void> {
	const cli = parseArgs(process.argv);
	const outcome = JSON.parse(readFileSync(cli.findingsPath, "utf-8")) as DetectionOutcome;
	const decisions = planFilings({
		outcome,
		stateDir: cli.stateDir,
		silenceDays: cli.silenceDays,
		dryRun: cli.dryRun,
	});

	for (const d of decisions) {
		if (d.action === "skip") {
			console.error(`[file-issue] SKIP ${d.incidentKey} — ${d.reason}`);
			continue;
		}
		if (d.action === "clear") continue;
		// create
		if (cli.dryRun) {
			console.log("=== DRY RUN ===");
			console.log(`title: ${d.title}`);
			console.log(`labels: autoresearch, regression, P2`);
			console.log("---");
			console.log(d.body);
			console.log("=== END ===");
			continue;
		}
		const issueNumber = ghCreateIssue(d.title ?? "", d.body ?? "", [
			"autoresearch",
			d.finding.type,
			"P2",
		]);
		const path = statePath(cli.stateDir, d.incidentKey);
		const prior = loadState(path);
		const nowIso = new Date().toISOString();
		const next: IncidentState = {
			incidentKey: d.incidentKey,
			variantId: d.finding.variantId,
			corpus: d.finding.corpus,
			findingType: d.finding.type,
			metric: d.finding.metric,
			fingerprintVersion: d.finding.fingerprintVersion,
			firstSeenAt: prior?.firstSeenAt ?? nowIso,
			lastNotifiedAt: nowIso,
			issueNumbers: [...(prior?.issueNumbers ?? []), issueNumber],
		};
		writeState(path, next);
		console.error(`[file-issue] CREATE #${issueNumber} ${d.incidentKey}`);
	}
}

const isMain = (() => {
	try {
		const here = fileURLToPath(import.meta.url);
		return process.argv[1] === here;
	} catch {
		return false;
	}
})();

if (isMain) {
	main().catch((err) => {
		console.error(
			"[file-regression-issue] fatal:",
			err instanceof Error ? err.message : String(err),
		);
		process.exit(1);
	});
}

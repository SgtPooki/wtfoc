/**
 * Fetch a compact summary of open GitHub issues for the LLM proposer
 * to use as additional context when picking what to fix.
 *
 * The maintainer files issues for known bugs, design constraints, and
 * incremental improvements; the autoresearch loop should be able to
 * correlate a regression with an existing issue ("query work-lineage
 * is brittle" + "#316 wl-1 paraphrase 3 fails reliably" → likely the
 * same root cause). Without this context, the LLM is reasoning about
 * regressions in isolation.
 *
 * Hard rules:
 *   - Read-only. Never modify, comment, or close issues from this path.
 *   - Cap context size — pulls only labels relevant to the loop, caps
 *     count, truncates bodies. The full issue list is always one
 *     `gh issue list` away if the LLM wants more.
 *   - Best-effort. If `gh` is unavailable or rate-limited, fail soft —
 *     return [] and let the proposer continue without issue context.
 */

import { execFileSync } from "node:child_process";

export interface OpenIssueSummary {
	number: number;
	title: string;
	labels: string[];
	bodyPreview: string;
	createdAt: string;
}

const DEFAULT_LABELS_OF_INTEREST: readonly string[] = [
	"bug",
	"enhancement",
	"autoresearch",
	"regression",
	"breach",
];

const DEFAULT_MAX_ISSUES = 25;
const DEFAULT_BODY_PREVIEW_CHARS = 600;

export interface FetchOpenIssuesOptions {
	maxIssues?: number;
	bodyPreviewChars?: number;
	/** Restrict to issues carrying any of these labels. Empty = all open. */
	labels?: readonly string[];
	/** Override the spawn function for tests. */
	spawnFn?: (cmd: string, args: string[]) => Buffer | string;
}

/**
 * Pull open issues via `gh issue list`. Returns [] on any error so
 * callers don't need to wrap.
 */
export function fetchOpenIssues(opts: FetchOpenIssuesOptions = {}): OpenIssueSummary[] {
	const maxIssues = opts.maxIssues ?? DEFAULT_MAX_ISSUES;
	const bodyChars = opts.bodyPreviewChars ?? DEFAULT_BODY_PREVIEW_CHARS;
	const labels = opts.labels ?? DEFAULT_LABELS_OF_INTEREST;
	const spawn = opts.spawnFn ?? ((cmd: string, args: string[]) =>
		execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }));

	const args = [
		"issue",
		"list",
		"--state",
		"open",
		"--limit",
		String(maxIssues),
		"--json",
		"number,title,labels,body,createdAt",
	];
	for (const l of labels) {
		args.push("--label", l);
	}

	let raw: string;
	try {
		const out = spawn("gh", args);
		raw = typeof out === "string" ? out : out.toString("utf-8");
	} catch {
		return [];
	}

	let parsed: Array<{
		number: number;
		title: string;
		labels: Array<{ name: string }>;
		body: string;
		createdAt: string;
	}>;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}

	return parsed.map((p) => ({
		number: p.number,
		title: p.title,
		labels: (p.labels ?? []).map((l) => l.name),
		bodyPreview:
			p.body.length > bodyChars ? `${p.body.slice(0, bodyChars)}…` : p.body,
		createdAt: p.createdAt,
	}));
}

/**
 * Compact prompt rendering. One line per issue title + labels, plus a
 * collapsible body preview when the body is short. Truncates the
 * overall section so the patch proposer prompt doesn't blow past
 * context limits.
 */
export function openIssuesToPromptLines(
	issues: readonly OpenIssueSummary[],
	maxLines = 60,
): string[] {
	if (issues.length === 0) return ["(no open issues fetched — gh unavailable or no matches)"];
	const lines: string[] = [];
	for (const i of issues) {
		const labelTag = i.labels.length > 0 ? ` [${i.labels.join(", ")}]` : "";
		lines.push(`- #${i.number} ${i.title}${labelTag}`);
		if (i.bodyPreview.length > 0 && lines.length < maxLines - 2) {
			const previewFirst = i.bodyPreview.split("\n").slice(0, 4).join(" ").slice(0, 240);
			if (previewFirst) lines.push(`    > ${previewFirst}`);
		}
		if (lines.length >= maxLines) break;
	}
	return lines;
}

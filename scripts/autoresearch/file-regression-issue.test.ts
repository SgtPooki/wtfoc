import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DetectionOutcome, Finding } from "./detect-regression.js";
import {
	buildIssueBody,
	buildIssueTitle,
	incidentKeyFor,
	planFilings,
} from "./file-regression-issue.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		type: "regression",
		variantId: "noar_div_rrOff",
		corpus: "filoz-ecosystem-2026-04-v12",
		corpusDigest: "digest",
		fingerprint: "fp-abc",
		fingerprintVersion: 1,
		metric: "passRate",
		latestValue: 0.6,
		baselineMean: 0.75,
		bootstrapMeanDelta: 0.15,
		probBgreaterA: 0.99,
		delta: -0.15,
		baselineSweepIds: ["b1", "b2", "b3"],
		latestSweepId: "bad",
		latestLoggedAt: "2026-04-29T03:00:00Z",
		reason: "3/4 baseline runs convincingly beat latest",
		...overrides,
	};
}

function makeOutcome(findings: Finding[]): DetectionOutcome {
	return {
		status: findings.length > 0 ? "regression" : "ok",
		corpora: [
			{
				corpus: "filoz-ecosystem-2026-04-v12",
				status: findings.length > 0 ? "regression" : "ok",
				latest: {
					sweepId: "bad",
					loggedAt: "2026-04-29T03:00:00Z",
					fingerprint: "fp-abc",
					variantId: "noar_div_rrOff",
					corpus: "filoz-ecosystem-2026-04-v12",
				},
				baselineCount: 4,
			},
		],
		findings,
		notes: [],
	};
}

describe("incidentKeyFor", () => {
	it("is stable across the same input", () => {
		const f = makeFinding();
		expect(incidentKeyFor(f)).toBe(incidentKeyFor(f));
	});

	it("differs when variantId differs", () => {
		expect(incidentKeyFor(makeFinding())).not.toBe(
			incidentKeyFor(makeFinding({ variantId: "ar_div_rrOff" })),
		);
	});

	it("differs when metric differs", () => {
		expect(incidentKeyFor(makeFinding())).not.toBe(
			incidentKeyFor(makeFinding({ metric: "demoCritical" })),
		);
	});

	it("differs when fingerprintVersion differs", () => {
		expect(incidentKeyFor(makeFinding())).not.toBe(
			incidentKeyFor(makeFinding({ fingerprintVersion: 2 })),
		);
	});

	it("does NOT depend on sweepId", () => {
		// Cross-night dedupe is meaningless if sweepId leaked into the key.
		const a = makeFinding({ latestSweepId: "monday" });
		const b = makeFinding({ latestSweepId: "tuesday" });
		expect(incidentKeyFor(a)).toBe(incidentKeyFor(b));
	});
});

describe("buildIssueTitle / buildIssueBody", () => {
	it("title for regression mentions variant + metric + corpus", () => {
		const t = buildIssueTitle(makeFinding(), false);
		expect(t).toContain("noar_div_rrOff");
		expect(t).toContain("passRate");
		expect(t).toContain("filoz");
	});

	it("title for breach uses the breach phrasing", () => {
		const t = buildIssueTitle(makeFinding({ type: "breach", metric: "overall" }), false);
		expect(t).toContain("breach");
	});

	it("re-filing prefixes 'Still regressed:'", () => {
		const t = buildIssueTitle(makeFinding(), true);
		expect(t.startsWith("Still regressed:")).toBe(true);
	});

	it("body includes identity, finding details, repro command, and run-log grep", () => {
		const body = buildIssueBody(makeFinding(), makeOutcome([makeFinding()]), false);
		expect(body).toContain("variantId: `noar_div_rrOff`");
		expect(body).toContain("runConfigFingerprint: `fp-abc`");
		expect(body).toContain("bootstrap meanΔ");
		expect(body).toContain("0.99");
		expect(body).toMatch(/pnpm autoresearch:sweep/);
		expect(body).toMatch(/grep -F 'bad'/);
	});

	it("breach body includes floor and gap, no bootstrap fields", () => {
		const f = makeFinding({
			type: "breach",
			metric: "demoCritical",
			latestValue: 0.8,
			floor: 1.0,
			bootstrapMeanDelta: undefined,
			probBgreaterA: undefined,
			baselineMean: undefined,
		});
		const body = buildIssueBody(f, makeOutcome([f]), false);
		expect(body).toContain("floor: 1.0000");
		expect(body).toContain("gap: -0.2000");
		expect(body).not.toContain("bootstrap meanΔ");
	});
});

describe("planFilings", () => {
	function tmpStateDir(): string {
		return mkdtempSync(join(tmpdir(), "wtfoc-regression-state-"));
	}

	it("decides 'create' for a brand new incident", () => {
		const stateDir = tmpStateDir();
		const decisions = planFilings({
			outcome: makeOutcome([makeFinding()]),
			stateDir,
		});
		expect(decisions).toHaveLength(1);
		expect(decisions[0]?.action).toBe("create");
		expect(decisions[0]?.previouslyFiled).toBe(false);
	});

	it("decides 'skip' when the same incident was filed yesterday", () => {
		const stateDir = tmpStateDir();
		const finding = makeFinding();
		const key = incidentKeyFor(finding);
		const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		writeFileSync(
			join(stateDir, `${key}.json`),
			JSON.stringify({
				incidentKey: key,
				variantId: finding.variantId,
				corpus: finding.corpus,
				findingType: finding.type,
				metric: finding.metric,
				fingerprintVersion: finding.fingerprintVersion,
				firstSeenAt: yesterday,
				lastNotifiedAt: yesterday,
				issueNumbers: [42],
			}),
		);
		const decisions = planFilings({
			outcome: makeOutcome([finding]),
			stateDir,
		});
		expect(decisions[0]?.action).toBe("skip");
		expect(decisions[0]?.previouslyFiled).toBe(true);
		expect(decisions[0]?.issueNumber).toBe(42);
	});

	it("decides 're-create' when last filing was past silence window", () => {
		const stateDir = tmpStateDir();
		const finding = makeFinding();
		const key = incidentKeyFor(finding);
		const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
		writeFileSync(
			join(stateDir, `${key}.json`),
			JSON.stringify({
				incidentKey: key,
				variantId: finding.variantId,
				corpus: finding.corpus,
				findingType: finding.type,
				metric: finding.metric,
				fingerprintVersion: finding.fingerprintVersion,
				firstSeenAt: eightDaysAgo,
				lastNotifiedAt: eightDaysAgo,
				issueNumbers: [42],
			}),
		);
		const decisions = planFilings({
			outcome: makeOutcome([finding]),
			stateDir,
			silenceDays: 7,
		});
		expect(decisions[0]?.action).toBe("create");
		expect(decisions[0]?.previouslyFiled).toBe(true);
		// Re-filed title should have the prefix.
		expect(decisions[0]?.title?.startsWith("Still regressed:")).toBe(true);
	});

	it("emits no decisions when outcome has no findings", () => {
		const stateDir = tmpStateDir();
		const decisions = planFilings({
			outcome: makeOutcome([]),
			stateDir,
		});
		expect(decisions).toHaveLength(0);
	});

	it("does not write state from planFilings (pure decision)", () => {
		const stateDir = tmpStateDir();
		planFilings({
			outcome: makeOutcome([makeFinding()]),
			stateDir,
		});
		// State file should NOT exist after a pure decision call.
		const key = incidentKeyFor(makeFinding());
		expect(() => readFileSync(join(stateDir, `${key}.json`), "utf-8")).toThrow();
	});
});

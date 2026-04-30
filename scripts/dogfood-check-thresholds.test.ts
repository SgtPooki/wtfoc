import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * End-to-end coverage for the cost-comparable refusal path
 * (#311 peer-review item (d)). Builds a synthetic dogfood report whose
 * `costComparable` flag indicates an unknown model id, then invokes
 * the threshold-check script via subprocess to confirm:
 *   - WITHOUT `--require-cost-rankable`: warns but exits 0
 *   - WITH `--require-cost-rankable`: hard-fails with exit 1
 *
 * Without this test the cost-comparable safety gate would only have
 * unit coverage on the aggregator, never end-to-end against the
 * threshold-check that downstream sweep harnesses will read.
 */

interface SyntheticInputs {
	costComparable?: { value: boolean; reasons: string[] };
}

function makeReport(inputs: SyntheticInputs): unknown {
	const baseMetrics = {
		goldQueriesVersion: "1.8.0",
		passRate: 0.95,
		passCount: 19,
		totalQueries: 20,
		applicableTotal: 20,
		applicableRate: 1,
		categoryBreakdown: {
			"direct-lookup": { total: 5, passed: 5, passRate: 1, skipped: 0 },
			"cross-source": { total: 5, passed: 5, passRate: 1, skipped: 0 },
			coverage: { total: 5, passed: 5, passRate: 1, skipped: 0 },
			synthesis: { total: 5, passed: 5, passRate: 1, skipped: 0 },
			"file-level": { total: 4, passed: 4, passRate: 1, skipped: 0 },
			"work-lineage": { total: 8, passed: 8, passRate: 1, skipped: 0 },
			"hard-negative": { total: 12, passed: 12, passRate: 1, skipped: 0 },
		},
		tierBreakdown: {
			"demo-critical": { total: 5, passed: 5, passRate: 1 },
		},
		portabilityBreakdown: {
			portable: { total: 13, passed: 13, passRate: 1 },
			"corpus-specific": { total: 7, passed: 7, passRate: 1 },
		},
	};

	return {
		reportSchemaVersion: "1.0.0",
		timestamp: new Date().toISOString(),
		collectionId: "test-collection",
		collectionName: "test-collection",
		stages: [
			{
				stage: "quality-queries",
				startedAt: new Date().toISOString(),
				durationMs: 0,
				verdict: "pass",
				summary: "synthetic",
				metrics: baseMetrics,
				checks: [],
			},
		],
		verdict: "pass",
		durationMs: 0,
		...(inputs.costComparable !== undefined ? { costComparable: inputs.costComparable } : {}),
	};
}

function runCheck(
	reportPath: string,
	flags: string[] = [],
): { exitCode: number; stdout: string } {
	try {
		const stdout = execFileSync(
			"pnpm",
			["exec", "tsx", "scripts/dogfood-check-thresholds.ts", ...flags, reportPath],
			{ encoding: "utf-8" },
		);
		return { exitCode: 0, stdout };
	} catch (err) {
		const e = err as { status?: number; stdout?: Buffer | string };
		const stdoutStr =
			typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString("utf-8") ?? "");
		return { exitCode: e.status ?? -1, stdout: stdoutStr };
	}
}

describe("dogfood-check-thresholds: costComparable gate (#311 peer-review (d))", () => {
	const dir = mkdtempSync(join(tmpdir(), "wtfoc-thresh-"));

	it("warns but does NOT fail when costComparable=false and --require-cost-rankable absent", () => {
		const report = makeReport({
			costComparable: { value: false, reasons: ["unknown-price:mystery-model"] },
		});
		const path = join(dir, "report-unknown-no-flag.json");
		writeFileSync(path, JSON.stringify(report));
		const result = runCheck(path);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("cost rankable: false");
		expect(result.stdout).toContain("unknown-price:mystery-model");
	});

	it("hard-fails when costComparable=false AND --require-cost-rankable is set", () => {
		const report = makeReport({
			costComparable: { value: false, reasons: ["unknown-price:mystery-model"] },
		});
		const path = join(dir, "report-unknown-with-flag.json");
		writeFileSync(path, JSON.stringify(report));
		const result = runCheck(path, ["--require-cost-rankable"]);
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("unknown-price:mystery-model");
	});

	it("passes when costComparable=true even with --require-cost-rankable set", () => {
		const report = makeReport({
			costComparable: { value: true, reasons: [] },
		});
		const path = join(dir, "report-rankable.json");
		writeFileSync(path, JSON.stringify(report));
		const result = runCheck(path, ["--require-cost-rankable"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("cost rankable: true");
	});

	it("hard-fails with --require-cost-rankable when costComparable field is missing", () => {
		const report = makeReport({}); // no costComparable at all
		const path = join(dir, "report-missing-flag.json");
		writeFileSync(path, JSON.stringify(report));
		const result = runCheck(path, ["--require-cost-rankable"]);
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("missing costComparable field");
	});
});

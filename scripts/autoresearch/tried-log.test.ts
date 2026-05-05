import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	alreadyTried,
	appendTriedRow,
	readTriedLog,
	triedLogPromptLines,
	type TriedLogRow,
} from "./tried-log.js";

function tmpPaths() {
	const dir = mkdtempSync(join(tmpdir(), "wtfoc-tried-"));
	return { dir, jsonlPath: join(dir, "tried.jsonl") };
}

function row(overrides: Partial<TriedLogRow> = {}): TriedLogRow {
	return {
		schemaVersion: 1,
		loggedAt: new Date().toISOString(),
		matrixName: "retrieval-baseline",
		variantId: "candidate-001",
		proposal: { axis: "topK", value: 15, rationale: "more candidates" },
		verdict: "rejected",
		reasons: ["meanDelta below threshold"],
		...overrides,
	};
}

describe("appendTriedRow + readTriedLog", () => {
	it("round-trips multiple rows", () => {
		const paths = tmpPaths();
		appendTriedRow(row({ variantId: "a" }), paths);
		appendTriedRow(row({ variantId: "b", verdict: "accepted" }), paths);
		const read = readTriedLog(paths);
		expect(read).toHaveLength(2);
		expect(read[1]?.verdict).toBe("accepted");
	});

	it("returns [] when no log exists", () => {
		const paths = tmpPaths();
		expect(readTriedLog(paths)).toEqual([]);
	});

	it("skips bad lines", () => {
		const paths = tmpPaths();
		appendTriedRow(row(), paths);
		// inject garbage
		(require("node:fs") as typeof import("node:fs")).appendFileSync(
			paths.jsonlPath,
			"not json\n",
		);
		appendTriedRow(row({ variantId: "z" }), paths);
		expect(readTriedLog(paths)).toHaveLength(2);
	});
});

describe("alreadyTried", () => {
	it("finds an exact (axis, value) match within the window", () => {
		const rows = [row({ proposal: { axis: "topK", value: 15, rationale: "x" } })];
		expect(alreadyTried(rows, "retrieval-baseline", "topK", 15)).not.toBeNull();
	});

	it("returns null when value differs", () => {
		const rows = [row({ proposal: { axis: "topK", value: 15, rationale: "x" } })];
		expect(alreadyTried(rows, "retrieval-baseline", "topK", 20)).toBeNull();
	});

	it("returns null when axis differs", () => {
		const rows = [row({ proposal: { axis: "topK", value: 15, rationale: "x" } })];
		expect(alreadyTried(rows, "retrieval-baseline", "diversityEnforce", 15)).toBeNull();
	});

	it("returns null when matrix differs", () => {
		const rows = [row({ proposal: { axis: "topK", value: 15, rationale: "x" } })];
		expect(alreadyTried(rows, "other-matrix", "topK", 15)).toBeNull();
	});

	it("returns null when last attempt is past the window", () => {
		const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
		const rows = [
			row({ loggedAt: old, proposal: { axis: "topK", value: 15, rationale: "x" } }),
		];
		expect(alreadyTried(rows, "retrieval-baseline", "topK", 15, 30)).toBeNull();
	});
});

describe("triedLogPromptLines", () => {
	it("emits placeholder when nothing tried", () => {
		const lines = triedLogPromptLines([], "retrieval-baseline");
		expect(lines.length).toBe(1);
		expect(lines[0]).toMatch(/no prior attempts/);
	});

	it("renders a structured entry per row with verdict header + rationale (newest last)", () => {
		const lines = triedLogPromptLines(
			[
				row({ proposal: { axis: "topK", value: 15, rationale: "first" } }),
				row({ verdict: "accepted", proposal: { axis: "topK", value: 20, rationale: "second" } }),
			],
			"retrieval-baseline",
		);
		// Each row produces a header line + a Rationale line (no Outcome
		// when reasons are empty); newest row comes last.
		const joined = lines.join("\n");
		expect(joined).toMatch(/\[rejected\] topK=15/);
		expect(joined).toMatch(/Rationale: first/);
		expect(joined).toMatch(/\[accepted\] topK=20/);
		expect(joined).toMatch(/Rationale: second/);
		// "rejected" header for first entry must appear BEFORE "accepted"
		// header in the rendered string.
		expect(joined.indexOf("[rejected]")).toBeLessThan(joined.indexOf("[accepted]"));
	});

	it("surfaces reject reasons as an Outcome line — closes the goldfish-memory gap (#382)", () => {
		const lines = triedLogPromptLines(
			[
				row({
					verdict: "rejected",
					proposal: { axis: "(code-patch)", value: "abc1234", rationale: "fix applySeedDiversity" },
					reasons: [
						"anti-overfit: worst per-baseline degradation 16.5pp > floor 2.0pp",
						"patch window: only 0/3 clear decide() (need 2)",
					],
				}),
			],
			"retrieval-baseline",
		);
		const joined = lines.join("\n");
		expect(joined).toMatch(/Outcome: anti-overfit/);
		expect(joined).toMatch(/16\.5pp/);
		expect(joined).toMatch(/0\/3 clear decide/);
	});

	it("filters by matrix", () => {
		const lines = triedLogPromptLines(
			[
				row({ matrixName: "retrieval-baseline", proposal: { axis: "topK", value: 15, rationale: "x" } }),
				row({ matrixName: "other-matrix", proposal: { axis: "topK", value: 20, rationale: "y" } }),
			],
			"retrieval-baseline",
		);
		const joined = lines.join("\n");
		expect(joined).toContain("topK=15");
		expect(joined).not.toContain("topK=20");
	});
});

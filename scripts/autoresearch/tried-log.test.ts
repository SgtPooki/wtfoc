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

	it("renders a one-line entry per row, newest last", () => {
		const lines = triedLogPromptLines(
			[
				row({ proposal: { axis: "topK", value: 15, rationale: "first" } }),
				row({ verdict: "accepted", proposal: { axis: "topK", value: 20, rationale: "second" } }),
			],
			"retrieval-baseline",
		);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("rejected");
		expect(lines[1]).toContain("accepted");
	});

	it("filters by matrix", () => {
		const lines = triedLogPromptLines(
			[
				row({ matrixName: "retrieval-baseline", proposal: { axis: "topK", value: 15, rationale: "x" } }),
				row({ matrixName: "other-matrix", proposal: { axis: "topK", value: 20, rationale: "y" } }),
			],
			"retrieval-baseline",
		);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("topK=15");
	});
});

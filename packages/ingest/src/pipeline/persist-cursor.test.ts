import { describe, expect, it } from "vitest";
import { decideCursorValue } from "./persist-cursor.js";

describe("decideCursorValue", () => {
	it("returns null with reason 'partial-run' when isPartialRun is true", () => {
		const result = decideCursorValue({
			isPartialRun: true,
			repoHeadSha: "abc123",
			maxTimestamp: "2026-06-01",
			existingCursorValue: null,
		});
		expect(result).toEqual({ cursorValue: null, reason: "partial-run" });
	});

	it("returns SHA as cursor when repoHeadSha is provided", () => {
		const result = decideCursorValue({
			isPartialRun: false,
			repoHeadSha: "abc123def456",
			maxTimestamp: "2026-01-01",
			existingCursorValue: null,
		});
		expect(result).toEqual({ cursorValue: "abc123def456", reason: "repo-head-sha" });
	});

	it("returns maxTimestamp when no repoHeadSha", () => {
		const result = decideCursorValue({
			isPartialRun: false,
			repoHeadSha: null,
			maxTimestamp: "2026-06-01T00:00:00Z",
			existingCursorValue: null,
		});
		expect(result).toEqual({ cursorValue: "2026-06-01T00:00:00Z", reason: "max-timestamp" });
	});

	it("uses existing cursor if it is later than maxTimestamp (no regression)", () => {
		const result = decideCursorValue({
			isPartialRun: false,
			repoHeadSha: null,
			maxTimestamp: "2026-01-01",
			existingCursorValue: "2026-06-01",
		});
		expect(result).toEqual({ cursorValue: "2026-06-01", reason: "existing-cursor-no-regression" });
	});

	it("returns null when no data available", () => {
		const result = decideCursorValue({
			isPartialRun: false,
			repoHeadSha: null,
			maxTimestamp: "",
			existingCursorValue: null,
		});
		expect(result).toEqual({ cursorValue: null, reason: "no-data" });
	});

	it("returns maxTimestamp when existing cursor is older", () => {
		const result = decideCursorValue({
			isPartialRun: false,
			repoHeadSha: null,
			maxTimestamp: "2026-06-01",
			existingCursorValue: "2026-01-01",
		});
		expect(result).toEqual({ cursorValue: "2026-06-01", reason: "max-timestamp" });
	});
});

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildSourceKey,
	type CursorData,
	cursorFilePath,
	getCursorSince,
	readCursors,
	writeCursors,
} from "./cursor-store.js";

describe("cursor-store", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = join(
			tmpdir(),
			`cursor-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("readCursors", () => {
		it("returns null for non-existent file", async () => {
			const result = await readCursors(join(testDir, "missing.json"));
			expect(result).toBeNull();
		});

		it("returns null for corrupt file", async () => {
			const path = join(testDir, "corrupt.json");
			await writeFile(path, "not valid json");
			const result = await readCursors(path);
			expect(result).toBeNull();
		});

		it("returns null for invalid schema version", async () => {
			const path = join(testDir, "bad-schema.json");
			await writeFile(path, JSON.stringify({ schemaVersion: 99, cursors: {} }));
			const result = await readCursors(path);
			expect(result).toBeNull();
		});

		it("reads valid cursor data", async () => {
			const data: CursorData = {
				schemaVersion: 1,
				cursors: {
					"github:owner/repo": {
						sourceKey: "github:owner/repo",
						adapterType: "github",
						cursorValue: "2026-01-01T00:00:00Z",
						lastRunAt: "2026-03-25T12:00:00Z",
						chunksIngested: 42,
					},
				},
			};
			const path = join(testDir, "valid.json");
			await writeFile(path, JSON.stringify(data));
			const result = await readCursors(path);
			expect(result).toEqual(data);
		});
	});

	describe("writeCursors", () => {
		it("creates parent directories and writes atomically", async () => {
			const nested = join(testDir, "sub", "dir", "cursors.json");
			const data: CursorData = {
				schemaVersion: 1,
				cursors: {
					"github:foo/bar": {
						sourceKey: "github:foo/bar",
						adapterType: "github",
						cursorValue: "2026-02-01T00:00:00Z",
						lastRunAt: "2026-03-25T12:00:00Z",
						chunksIngested: 10,
					},
				},
			};
			await writeCursors(nested, data);
			const content = await readFile(nested, "utf-8");
			expect(JSON.parse(content)).toEqual(data);
		});

		it("overwrites existing cursor data", async () => {
			const path = join(testDir, "overwrite.json");
			const data1: CursorData = { schemaVersion: 1, cursors: {} };
			const data2: CursorData = {
				schemaVersion: 1,
				cursors: {
					"repo:/tmp/test": {
						sourceKey: "repo:/tmp/test",
						adapterType: "repo",
						cursorValue: "2026-03-01T00:00:00Z",
						lastRunAt: "2026-03-25T12:00:00Z",
						chunksIngested: 5,
					},
				},
			};
			await writeCursors(path, data1);
			await writeCursors(path, data2);
			const result = await readCursors(path);
			expect(result).toEqual(data2);
		});
	});

	describe("cursorFilePath", () => {
		it("returns the expected path", () => {
			expect(cursorFilePath("/manifests", "my-collection")).toBe(
				"/manifests/my-collection.ingest-cursors.json",
			);
		});
	});

	describe("getCursorSince", () => {
		it("returns undefined for null data", () => {
			expect(getCursorSince(null, "github:owner/repo")).toBeUndefined();
		});

		it("returns undefined for missing source key", () => {
			const data: CursorData = { schemaVersion: 1, cursors: {} };
			expect(getCursorSince(data, "github:owner/repo")).toBeUndefined();
		});

		it("returns cursorValue for existing source key", () => {
			const data: CursorData = {
				schemaVersion: 1,
				cursors: {
					"github:owner/repo": {
						sourceKey: "github:owner/repo",
						adapterType: "github",
						cursorValue: "2026-01-15T00:00:00Z",
						lastRunAt: "2026-03-25T12:00:00Z",
						chunksIngested: 100,
					},
				},
			};
			expect(getCursorSince(data, "github:owner/repo")).toBe("2026-01-15T00:00:00Z");
		});
	});

	describe("buildSourceKey", () => {
		it("builds key from adapter type and source arg", () => {
			expect(buildSourceKey("github", "owner/repo")).toBe("github:owner/repo");
			expect(buildSourceKey("repo", "/path/to/dir")).toBe("repo:/path/to/dir");
		});
	});
});

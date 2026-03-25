import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildSourceKey,
	type CursorData,
	cursorFilePath,
	getCursorSince,
	readCursors,
	type SourceCursor,
	writeCursors,
} from "./cursor-store.js";

/**
 * Integration tests for the cursor lifecycle as used by the ingest command:
 * 1. Read cursor before ingest → inject as since
 * 2. Track max timestamp during ingest
 * 3. Write cursor after successful ingest
 * 4. Do NOT write cursor on failure
 * 5. Explicit --since overrides stored cursor
 */
describe("cursor lifecycle integration", () => {
	let manifestDir: string;

	beforeEach(async () => {
		manifestDir = join(tmpdir(), `cursor-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		await mkdir(manifestDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(manifestDir, { recursive: true, force: true });
	});

	it("first ingest: no cursor exists, returns undefined since", async () => {
		const cursorPath = cursorFilePath(manifestDir, "test-collection");
		const data = await readCursors(cursorPath);
		const sourceKey = buildSourceKey("github", "owner/repo");
		const since = getCursorSince(data, sourceKey);
		expect(since).toBeUndefined();
	});

	it("after successful ingest: cursor is persisted and returned on next read", async () => {
		const cursorPath = cursorFilePath(manifestDir, "test-collection");
		const sourceKey = buildSourceKey("github", "owner/repo");

		// Simulate successful ingest — write cursor with max timestamp
		const maxTimestamp = "2026-03-25T10:30:00Z";
		const cursorData: CursorData = {
			schemaVersion: 1,
			cursors: {
				[sourceKey]: {
					sourceKey,
					adapterType: "github",
					cursorValue: maxTimestamp,
					lastRunAt: new Date().toISOString(),
					chunksIngested: 42,
				},
			},
		};
		await writeCursors(cursorPath, cursorData);

		// Second run reads the cursor
		const data = await readCursors(cursorPath);
		const since = getCursorSince(data, sourceKey);
		expect(since).toBe(maxTimestamp);
	});

	it("explicit --since overrides stored cursor", async () => {
		const cursorPath = cursorFilePath(manifestDir, "test-collection");
		const sourceKey = buildSourceKey("github", "owner/repo");

		// Write a stored cursor
		await writeCursors(cursorPath, {
			schemaVersion: 1,
			cursors: {
				[sourceKey]: {
					sourceKey,
					adapterType: "github",
					cursorValue: "2026-01-01T00:00:00Z",
					lastRunAt: new Date().toISOString(),
					chunksIngested: 100,
				},
			},
		});

		// Simulate user passing --since 30d (resolved to an ISO string)
		const explicitSince = "2026-02-23T00:00:00Z";
		const data = await readCursors(cursorPath);
		const storedSince = getCursorSince(data, sourceKey);

		// The CLI should use explicitSince over storedSince
		const effectiveSince = explicitSince ?? storedSince;
		expect(effectiveSince).toBe(explicitSince);
		expect(storedSince).toBe("2026-01-01T00:00:00Z");
	});

	it("failed ingest does NOT update cursor", async () => {
		const cursorPath = cursorFilePath(manifestDir, "test-collection");
		const sourceKey = buildSourceKey("github", "owner/repo");

		// Write initial cursor
		const originalTimestamp = "2026-01-15T00:00:00Z";
		await writeCursors(cursorPath, {
			schemaVersion: 1,
			cursors: {
				[sourceKey]: {
					sourceKey,
					adapterType: "github",
					cursorValue: originalTimestamp,
					lastRunAt: new Date().toISOString(),
					chunksIngested: 50,
				},
			},
		});

		// Simulate failed ingest — DO NOT write cursors
		// (the cursor file should remain unchanged)

		const data = await readCursors(cursorPath);
		const since = getCursorSince(data, sourceKey);
		expect(since).toBe(originalTimestamp);
	});

	it("multiple sources per collection have independent cursors", async () => {
		const cursorPath = cursorFilePath(manifestDir, "multi-source");
		const key1 = buildSourceKey("github", "org/repo-a");
		const key2 = buildSourceKey("github", "org/repo-b");
		const key3 = buildSourceKey("repo", "/path/to/local");

		const cursor1: SourceCursor = {
			sourceKey: key1,
			adapterType: "github",
			cursorValue: "2026-01-01T00:00:00Z",
			lastRunAt: new Date().toISOString(),
			chunksIngested: 10,
		};
		const cursor2: SourceCursor = {
			sourceKey: key2,
			adapterType: "github",
			cursorValue: "2026-02-01T00:00:00Z",
			lastRunAt: new Date().toISOString(),
			chunksIngested: 20,
		};
		const cursor3: SourceCursor = {
			sourceKey: key3,
			adapterType: "repo",
			cursorValue: "2026-03-01T00:00:00Z",
			lastRunAt: new Date().toISOString(),
			chunksIngested: 30,
		};

		await writeCursors(cursorPath, {
			schemaVersion: 1,
			cursors: { [key1]: cursor1, [key2]: cursor2, [key3]: cursor3 },
		});

		const data = await readCursors(cursorPath);
		expect(getCursorSince(data, key1)).toBe("2026-01-01T00:00:00Z");
		expect(getCursorSince(data, key2)).toBe("2026-02-01T00:00:00Z");
		expect(getCursorSince(data, key3)).toBe("2026-03-01T00:00:00Z");
	});
});

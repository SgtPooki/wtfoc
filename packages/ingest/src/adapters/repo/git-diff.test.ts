import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getFileLastCommit, getFilesLastCommits } from "./git-diff.js";

// The test-repo fixture lives inside this git repo, so git log works on its files
const REPO_ROOT = resolve(import.meta.dirname ?? ".", "../../../../..");
const FIXTURE_REL = "fixtures/test-repo";

describe("getFileLastCommit", () => {
	it("returns commit info for a known file", async () => {
		const info = await getFileLastCommit(REPO_ROOT, `${FIXTURE_REL}/src/storage.ts`);
		expect(info).not.toBeNull();
		expect(info?.sha).toMatch(/^[0-9a-f]{40}$/);
		expect(info?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
		expect(info?.author).toBeTruthy();
		expect(typeof info?.message).toBe("string");
	});

	it("returns null for a non-existent file", async () => {
		const info = await getFileLastCommit(REPO_ROOT, "does/not/exist.ts");
		expect(info).toBeNull();
	});
});

describe("getFilesLastCommits", () => {
	it("returns a map of commit info for multiple files", async () => {
		const files = [
			`${FIXTURE_REL}/src/storage.ts`,
			`${FIXTURE_REL}/src/upload.ts`,
			`${FIXTURE_REL}/docs/getting-started.md`,
		];
		const map = await getFilesLastCommits(REPO_ROOT, files);
		expect(map.size).toBe(3);
		for (const fp of files) {
			const info = map.get(fp);
			expect(info).toBeDefined();
			expect(info?.sha).toMatch(/^[0-9a-f]{40}$/);
			expect(info?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		}
	});

	it("returns an empty map for an empty file list", async () => {
		const map = await getFilesLastCommits(REPO_ROOT, []);
		expect(map.size).toBe(0);
	});

	it("skips files that have no git history", async () => {
		const files = [`${FIXTURE_REL}/src/storage.ts`, "does/not/exist.ts"];
		const map = await getFilesLastCommits(REPO_ROOT, files);
		expect(map.size).toBe(1);
		expect(map.has(`${FIXTURE_REL}/src/storage.ts`)).toBe(true);
		expect(map.has("does/not/exist.ts")).toBe(false);
	});
});

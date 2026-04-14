import { execFile } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Returns true if the given directory contains a .git entry (i.e. is a
 * working git clone, not a leftover empty directory or symlinked husk).
 */
async function isValidGitClone(dir: string): Promise<boolean> {
	try {
		await stat(`${dir}/.git`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Refresh an existing shallow clone to the remote's default branch. Uses
 * `fetch --depth=1` + `reset --hard FETCH_HEAD` instead of `git pull` because
 * shallow clones and detached HEADs can confuse pull, and pull doesn't
 * overwrite local divergence that would prevent fast-forwards.
 *
 * Returns true on success, false if any git command failed — the caller
 * should then nuke + re-clone.
 */
async function refreshClone(dir: string): Promise<boolean> {
	try {
		await execFileAsync("git", ["fetch", "--depth=1", "origin", "HEAD"], { cwd: dir });
		await execFileAsync("git", ["reset", "--hard", "FETCH_HEAD"], { cwd: dir });
		return true;
	} catch {
		return false;
	}
}

export async function acquireRepo(source: string): Promise<string> {
	if (source.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
		const tmpDir = `/tmp/wtfoc-repo-${source.replace("/", "-")}`;

		// If the cache dir exists and is a valid clone, update it to the remote's
		// current HEAD. If the update fails (diverged, corrupt, stale refs) OR the
		// dir isn't a valid clone to begin with, remove and re-clone fresh.
		// Previously `git pull` silently failed via .catch(() => {}), leaving the
		// caller with stale or empty content and zero chunks produced.
		try {
			await stat(tmpDir);
			if (await isValidGitClone(tmpDir)) {
				if (await refreshClone(tmpDir)) return tmpDir;
				console.error(`[wtfoc] Clone refresh failed for ${tmpDir}, re-cloning`);
			}
			await rm(tmpDir, { recursive: true, force: true });
		} catch {
			// Directory doesn't exist — fall through to clone below
		}

		// Fresh clone — use execFile to prevent injection
		await execFileAsync("git", [
			"clone",
			"--depth",
			"1",
			`https://github.com/${source}.git`,
			tmpDir,
		]);
		return tmpDir;
	}
	return source;
}

export function extractRepoName(source: string): string {
	if (source.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
		return source;
	}
	return source.split("/").pop() ?? source;
}

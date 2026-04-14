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

export async function acquireRepo(source: string): Promise<string> {
	if (source.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
		const tmpDir = `/tmp/wtfoc-repo-${source.replace("/", "-")}`;

		// If the cache dir exists but isn't a valid git clone (e.g. broken from
		// a prior failed run, or wiped contents), remove it so we re-clone fresh.
		// Previously `git pull` silently failed via .catch(() => {}), leaving the
		// caller with an empty dir and zero chunks produced — a silent corruption.
		try {
			await stat(tmpDir);
			if (await isValidGitClone(tmpDir)) {
				await execFileAsync("git", ["pull", "--ff-only"], { cwd: tmpDir }).catch(() => {});
				return tmpDir;
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

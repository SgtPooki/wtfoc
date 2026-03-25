import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function acquireRepo(source: string): Promise<string> {
	if (source.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
		const tmpDir = `/tmp/wtfoc-repo-${source.replace("/", "-")}`;
		try {
			await stat(tmpDir);
			// Already cloned — pull latest
			await execFileAsync("git", ["pull", "--ff-only"], { cwd: tmpDir }).catch(() => {});
		} catch {
			// Clone fresh — use execFile to prevent injection
			await execFileAsync("git", [
				"clone",
				"--depth",
				"1",
				`https://github.com/${source}.git`,
				tmpDir,
			]);
		}
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

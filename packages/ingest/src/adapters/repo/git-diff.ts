import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
	status: FileChangeStatus;
	path: string;
	/** For renames, the old path */
	oldPath?: string;
}

/**
 * Get the current HEAD commit SHA for a repo.
 * Returns null if the directory is not a git repo.
 */
export async function getHeadCommit(repoPath: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoPath });
		return stdout.trim();
	} catch {
		return null;
	}
}

/**
 * Check if a path is a git repository.
 */
export async function isGitRepo(repoPath: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd: repoPath,
		});
		return stdout.trim() === "true";
	} catch {
		return false;
	}
}

/**
 * Check if a commit SHA exists in the repo (handles shallow clones, branch switches).
 */
export async function commitExists(repoPath: string, sha: string): Promise<boolean> {
	try {
		await execFileAsync("git", ["cat-file", "-t", sha], { cwd: repoPath });
		return true;
	} catch {
		return false;
	}
}

/**
 * Get changed files between two commits using git diff --name-status.
 * Uses -M flag to detect renames.
 */
export async function getChangedFiles(
	repoPath: string,
	fromSha: string,
	toSha: string,
): Promise<ChangedFile[]> {
	const { stdout } = await execFileAsync(
		"git",
		["diff", "--name-status", "-M", `${fromSha}..${toSha}`],
		{ cwd: repoPath, maxBuffer: 10 * 1024 * 1024 },
	);

	const files: ChangedFile[] = [];
	for (const line of stdout.trim().split("\n")) {
		if (!line) continue;
		const parts = line.split("\t");
		const statusCode = parts[0];
		if (!statusCode) continue;

		if (statusCode.startsWith("R")) {
			// Rename: R100\toldPath\tnewPath
			const oldPath = parts[1];
			const newPath = parts[2];
			if (oldPath && newPath) {
				files.push({ status: "renamed", path: newPath, oldPath });
			}
		} else if (statusCode === "A") {
			const path = parts[1];
			if (path) files.push({ status: "added", path });
		} else if (statusCode === "M") {
			const path = parts[1];
			if (path) files.push({ status: "modified", path });
		} else if (statusCode === "D") {
			const path = parts[1];
			if (path) files.push({ status: "deleted", path });
		}
	}

	return files;
}

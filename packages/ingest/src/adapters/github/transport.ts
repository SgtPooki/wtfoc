import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	GitHubApiError,
	GitHubCliMissingError,
	GitHubNotFoundError,
	GitHubRateLimitError,
} from "@wtfoc/common";

const execFileAsync = promisify(execFile);

export type ExecFn = (
	cmd: string,
	args: string[],
	signal?: AbortSignal,
) => Promise<{ stdout: string; stderr: string }>;

const MAX_RATE_LIMIT_WAIT_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 5000;

export async function defaultExecFn(
	cmd: string,
	args: string[],
	signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
	return execFileAsync(cmd, args, { signal, maxBuffer: 50 * 1024 * 1024 });
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

/**
 * Parse paginated gh api output. With --paginate, gh api emits
 * one JSON array per page concatenated in stdout. We need to handle
 * both single-array and multi-array (JSONL-like) output.
 */
export function parsePaginatedJson(stdout: string): unknown[] {
	const trimmed = stdout.trim();
	if (!trimmed) return [];

	// Try single JSON parse first (single page or --slurp)
	try {
		const parsed = JSON.parse(trimmed);
		return Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		// Multi-page: gh api --paginate emits multiple JSON arrays
		// Try splitting on ][ boundary (array concatenation)
		const results: unknown[] = [];
		// gh api --paginate concatenates arrays: [page1][page2]
		// Split by finding ][, parse each chunk
		const chunks = trimmed.split(/\]\s*\[/);
		for (let i = 0; i < chunks.length; i++) {
			let chunk = chunks[i] ?? "";
			if (i === 0 && !chunk.startsWith("[")) chunk = `[${chunk}`;
			else if (i > 0) chunk = `[${chunk}`;
			if (i === chunks.length - 1 && !chunk.endsWith("]")) chunk = `${chunk}]`;
			else if (i < chunks.length - 1) chunk = `${chunk}]`;
			try {
				const parsed = JSON.parse(chunk);
				if (Array.isArray(parsed)) results.push(...parsed);
				else results.push(parsed);
			} catch {
				// Skip unparseable page chunks in multi-page output
			}
		}
		if (results.length === 0 && trimmed.length > 0) {
			throw new SyntaxError(`Failed to parse GitHub API response: ${trimmed.slice(0, 100)}`);
		}
		return results;
	}
}

function parseRetryWait(stderr: string): number | undefined {
	const retryAfterMatch = stderr.match(/retry.after[:\s]+(\d+)/i);
	if (retryAfterMatch?.[1]) {
		return Number.parseInt(retryAfterMatch[1], 10) * 1000;
	}
	const resetMatch = stderr.match(/x-ratelimit-reset[:\s]+(\d+)/i);
	if (resetMatch?.[1]) {
		const resetTime = Number.parseInt(resetMatch[1], 10) * 1000;
		const waitMs = resetTime - Date.now();
		return waitMs > 0 ? waitMs : BASE_BACKOFF_MS;
	}
	return undefined;
}

export async function ghApi(
	execFn: ExecFn,
	path: string,
	signal?: AbortSignal,
	extraArgs?: string[],
): Promise<unknown[]> {
	// No --include: rate limit info comes via stderr, not headers.
	// --paginate handles Link-header pagination automatically.
	const args = ["api", path, "--paginate", "--method", "GET"];
	if (extraArgs) args.push(...extraArgs);

	let totalWaitMs = 0;
	let attempt = 0;

	while (true) {
		signal?.throwIfAborted();
		try {
			const { stdout } = await execFn("gh", args, signal);
			return parsePaginatedJson(stdout);
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : String(err);
			const stderr = (err as { stderr?: string }).stderr ?? errMsg;

			if (stderr.includes("ENOENT") || errMsg.includes("ENOENT")) {
				throw new GitHubCliMissingError();
			}
			if (stderr.includes("Not Found") || stderr.includes("404")) {
				throw new GitHubNotFoundError(path);
			}
			// Only retry on explicit rate limit messages, not generic 403
			if (stderr.includes("rate limit") || stderr.includes("API rate limit exceeded")) {
				const waitMs = parseRetryWait(stderr) ?? BASE_BACKOFF_MS * 2 ** attempt;
				if (totalWaitMs + waitMs > MAX_RATE_LIMIT_WAIT_MS) {
					throw new GitHubRateLimitError(path);
				}
				await sleep(waitMs, signal);
				totalWaitMs += waitMs;
				attempt++;
				continue;
			}
			throw new GitHubApiError(errMsg, path, err);
		}
	}
}

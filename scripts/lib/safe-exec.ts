/**
 * Wrapper around node:child_process execFileSync that redacts secrets
 * from error messages before re-throwing.
 *
 * Why: when a subprocess exits non-zero, Node includes the FULL argv
 * in the thrown Error.message. Any caller passing an API key, OAuth
 * token, or session cookie via argv leaks it the moment the child
 * fails. Observed live: a buggy LLM patch caused TypeScript
 * compilation in a sweep subprocess to fail, and OPENROUTER_API_KEY
 * appeared verbatim in the cron-stderr log via the parent's stderr.
 *
 * Two-fold defense:
 *   1. Code SHOULD prefer env vars over argv for secrets.
 *   2. As defense-in-depth, this wrapper scrubs any token-shaped
 *      strings from error messages — so a future regression that
 *      reintroduces an argv secret cannot leak.
 */

import { execFileSync, type ExecFileSyncOptions } from "node:child_process";

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
	/sk-or-v1-[A-Za-z0-9]{8,}/g,
	/sk-ant-[A-Za-z0-9_-]{16,}/g,
	/sk-proj-[A-Za-z0-9_-]{16,}/g,
	/sk-[A-Za-z0-9]{20,}/g,
	/ghp_[A-Za-z0-9]{20,}/g,
	/gho_[A-Za-z0-9]{20,}/g,
	/ghu_[A-Za-z0-9]{20,}/g,
	/Bearer [A-Za-z0-9._-]{16,}/g,
];

function redactArgvPairs(s: string): string {
	return s.replace(
		/(--[a-z][a-z-]*-(?:key|token|secret|password))(\s+|=)\S+/gi,
		(_full, flag, sep) => `${flag}${sep}<redacted>`,
	);
}

export function redactSecrets(s: string): string {
	let out = s;
	for (const re of SECRET_PATTERNS) {
		out = out.replace(re, "<redacted>");
	}
	out = redactArgvPairs(out);
	return out;
}

// Mirror execFileSync's overload set so encoding-set callers still get
// `string` back. Without this, callers that did `.trim()` on the result
// see a `Buffer | string` union and have to cast.
export function safeExecFileSync(
	cmd: string,
	args: readonly string[],
	options: ExecFileSyncOptions & { encoding: BufferEncoding },
): string;
export function safeExecFileSync(
	cmd: string,
	args: readonly string[],
	options?: ExecFileSyncOptions,
): Buffer;
export function safeExecFileSync(
	cmd: string,
	args: readonly string[],
	options?: ExecFileSyncOptions,
): Buffer | string {
	try {
		return execFileSync(cmd, args, options);
	} catch (err) {
		if (err instanceof Error) {
			err.message = redactSecrets(err.message);
		}
		throw err;
	}
}

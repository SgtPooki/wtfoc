import { GitHubApiError, GitHubNotFoundError, GitHubRateLimitError } from "@wtfoc/common";
import type { GitHubTokenProvider } from "./auth.js";
import { PatTokenProvider } from "./auth.js";
import type { ExecFn } from "./transport.js";
import { sleep } from "./transport.js";

const MAX_RATE_LIMIT_WAIT_MS = 5 * 60 * 1000;
const BASE_BACKOFF_MS = 5000;
const GITHUB_API_BASE = "https://api.github.com";

/**
 * Token provider interface re-exported for convenience.
 * Use GitHubTokenProvider from auth.ts for the canonical type.
 */
export type TokenProvider = GitHubTokenProvider;

function parseRetryFromHeaders(headers: Headers): number | undefined {
	const retryAfter = headers.get("retry-after");
	if (retryAfter) {
		const seconds = Number.parseInt(retryAfter, 10);
		if (Number.isFinite(seconds)) return seconds * 1000;
	}
	const reset = headers.get("x-ratelimit-reset");
	if (reset) {
		const resetTime = Number.parseInt(reset, 10) * 1000;
		const waitMs = resetTime - Date.now();
		return waitMs > 0 ? waitMs : BASE_BACKOFF_MS;
	}
	return undefined;
}

async function fetchAllPages(
	path: string,
	token: string | null,
	signal?: AbortSignal,
	extraParams?: Record<string, string>,
): Promise<unknown[]> {
	const results: unknown[] = [];
	let url = `${GITHUB_API_BASE}/${path}`;

	if (extraParams) {
		const u = new URL(url);
		for (const [k, v] of Object.entries(extraParams)) {
			u.searchParams.set(k, v);
		}
		url = u.toString();
	}

	let totalWaitMs = 0;
	let attempt = 0;

	while (url) {
		signal?.throwIfAborted();

		const headers: Record<string, string> = {
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		};
		if (token) headers.Authorization = `token ${token}`;

		let response: Response;
		try {
			response = await fetch(url, { headers, signal });
		} catch (err) {
			throw new GitHubApiError(err instanceof Error ? err.message : String(err), path, err);
		}

		if (response.status === 404) {
			throw new GitHubNotFoundError(path);
		}

		if (response.status === 403 || response.status === 429) {
			const remaining = response.headers.get("x-ratelimit-remaining");
			if (remaining === "0" || response.status === 429) {
				const waitMs = parseRetryFromHeaders(response.headers) ?? BASE_BACKOFF_MS * 2 ** attempt;
				if (totalWaitMs + waitMs > MAX_RATE_LIMIT_WAIT_MS) {
					throw new GitHubRateLimitError(path);
				}
				await sleep(waitMs, signal);
				totalWaitMs += waitMs;
				attempt++;
				continue;
			}
		}

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new GitHubApiError(`GitHub API ${response.status}: ${body.slice(0, 200)}`, path);
		}

		const body = await response.json();
		if (Array.isArray(body)) {
			results.push(...body);
		} else {
			results.push(body);
		}

		// Parse Link header for pagination
		const linkHeader = response.headers.get("link");
		url = "";
		if (linkHeader) {
			const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
			if (nextMatch?.[1]) {
				url = nextMatch[1];
			}
		}

		attempt = 0;
		totalWaitMs = 0;
	}

	return results;
}

/**
 * Create an ExecFn that uses HTTP fetch instead of the gh CLI.
 * Drop-in replacement for defaultExecFn — the GitHubAdapter doesn't need to change.
 */
export function createHttpExecFn(tokenProvider?: TokenProvider): ExecFn {
	const envToken = process.env.GITHUB_TOKEN;
	const provider = tokenProvider ?? (envToken ? new PatTokenProvider(envToken) : null);

	return async (cmd: string, args: string[], signal?: AbortSignal) => {
		if (cmd !== "gh") {
			throw new Error(`HttpTransport only handles 'gh' commands, got '${cmd}'`);
		}

		const token = provider ? await provider.getToken() : null;

		// Parse gh CLI args to extract the API path and parameters
		// Expected forms:
		//   gh api <path> --paginate --method GET [-f key=value ...]
		//   gh api graphql -f query=<graphql>
		const subCmd = args[0];
		if (subCmd !== "api") {
			throw new Error(`HttpTransport only handles 'gh api' commands, got 'gh ${subCmd}'`);
		}

		const apiPath = args[1];
		if (!apiPath) {
			throw new Error("HttpTransport: missing API path");
		}

		// Check for GraphQL
		if (apiPath === "graphql") {
			const queryArg = args.find((a) => a.startsWith("query="));
			if (!queryArg) {
				throw new Error("HttpTransport: GraphQL request missing query= argument");
			}
			const query = queryArg.slice("query=".length);
			return fetchGraphQL(query, token, signal);
		}

		// REST API call — extract -f filters as query params
		const params: Record<string, string> = {};
		for (let i = 2; i < args.length; i++) {
			const nextArg = args[i + 1];
			if (args[i] === "-f" && nextArg) {
				const eqIdx = nextArg.indexOf("=");
				if (eqIdx > 0) {
					params[nextArg.slice(0, eqIdx)] = nextArg.slice(eqIdx + 1);
				}
				i++;
			}
		}

		const results = await fetchAllPages(
			apiPath,
			token,
			signal,
			Object.keys(params).length > 0 ? params : undefined,
		);
		const stdout = JSON.stringify(results);
		return { stdout, stderr: "" };
	};
}

async function fetchGraphQL(
	query: string,
	token: string | null,
	signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json",
	};
	if (token) headers.Authorization = `bearer ${token}`;

	const response = await fetch(`${GITHUB_API_BASE}/graphql`, {
		method: "POST",
		headers,
		body: JSON.stringify({ query }),
		signal,
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new GitHubApiError(`GraphQL ${response.status}: ${body.slice(0, 200)}`, "graphql");
	}

	const body = await response.text();
	return { stdout: body, stderr: "" };
}

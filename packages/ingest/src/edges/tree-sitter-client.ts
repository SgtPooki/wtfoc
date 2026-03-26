/**
 * HTTP client for the tree-sitter parser sidecar.
 * Mirrors the llm-client.ts pattern: raw fetch, no SDK, AbortSignal support.
 */

export interface TreeSitterClientOptions {
	baseUrl: string;
	timeoutMs?: number;
}

export interface TreeSitterParseRequest {
	language: string;
	content: string;
	path?: string;
}

export interface TreeSitterEdge {
	type: string;
	targetId: string;
	targetType: string;
	confidence: number;
	evidence: string;
}

export interface TreeSitterParseResponse {
	edges: TreeSitterEdge[];
	language: string;
	nodeCount: number;
}

export interface TreeSitterHealthResponse {
	status: string;
	languages: string[];
}

/**
 * Parse code via the tree-sitter sidecar HTTP service.
 * Returns null if the sidecar is unreachable (fail-open).
 */
export async function treeSitterParse(
	req: TreeSitterParseRequest,
	options: TreeSitterClientOptions,
	signal?: AbortSignal,
): Promise<TreeSitterParseResponse | null> {
	const url = `${options.baseUrl.replace(/\/+$/, "")}/parse`;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);

	// Track the abort handler so we can remove it in finally (prevents listener leak)
	let onAbort: (() => void) | undefined;
	if (signal) {
		if (signal.aborted) {
			clearTimeout(timeout);
			throw signal.reason;
		}
		onAbort = () => controller.abort(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
	}

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(req),
			signal: controller.signal,
		});

		if (!response.ok) {
			// Non-2xx — fail-open silently (CompositeEdgeExtractor reports failures)
			return null;
		}

		return (await response.json()) as TreeSitterParseResponse;
	} catch {
		// If the caller's signal triggered the abort, propagate instead of swallowing
		if (signal?.aborted) throw signal.reason;
		// Connection refused, our own timeout, network error — fail-open silently
		return null;
	} finally {
		clearTimeout(timeout);
		if (signal && onAbort) signal.removeEventListener("abort", onAbort);
	}
}

/**
 * Check if the tree-sitter sidecar is healthy and which languages are available.
 */
export async function treeSitterHealth(
	options: TreeSitterClientOptions,
): Promise<TreeSitterHealthResponse | null> {
	const url = `${options.baseUrl.replace(/\/+$/, "")}/health`;

	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
		});
		if (!response.ok) return null;
		return (await response.json()) as TreeSitterHealthResponse;
	} catch {
		return null;
	}
}

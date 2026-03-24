import type {
	CollectionSummary,
	EdgesResponse,
	QueryResponse,
	SourcesResponse,
	StatusResponse,
	TraceResponse,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

async function apiFetch<T>(
	path: string,
	params?: Record<string, string>,
	signal?: AbortSignal,
): Promise<T> {
	const url = new URL(`${API_BASE}${path}`, window.location.origin);
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			url.searchParams.set(k, v);
		}
	}

	const res = await fetch(url.toString(), { signal });

	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: res.statusText }));
		throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
	}

	return res.json() as Promise<T>;
}

// ─── Collection-scoped endpoints ────────────────────────────────────────────

function collectionPath(collection: string, endpoint: string): string {
	return `/api/collections/${encodeURIComponent(collection)}/${endpoint}`;
}

export function fetchStatus(collection: string, signal?: AbortSignal): Promise<StatusResponse> {
	return apiFetch<StatusResponse>(collectionPath(collection, "status"), undefined, signal);
}

export function fetchTrace(
	collection: string,
	q: string,
	signal?: AbortSignal,
): Promise<TraceResponse> {
	return apiFetch<TraceResponse>(collectionPath(collection, "trace"), { q }, signal);
}

export function fetchQuery(
	collection: string,
	q: string,
	k = 10,
	signal?: AbortSignal,
): Promise<QueryResponse> {
	return apiFetch<QueryResponse>(collectionPath(collection, "query"), { q, k: String(k) }, signal);
}

export function fetchEdges(collection: string, signal?: AbortSignal): Promise<EdgesResponse> {
	return apiFetch<EdgesResponse>(collectionPath(collection, "edges"), undefined, signal);
}

export function fetchSources(collection: string, signal?: AbortSignal): Promise<SourcesResponse> {
	return apiFetch<SourcesResponse>(collectionPath(collection, "sources"), undefined, signal);
}

// ─── Global endpoints ───────────────────────────────────────────────────────

export function fetchCollections(signal?: AbortSignal): Promise<CollectionSummary[]> {
	return apiFetch<CollectionSummary[]>("/api/collections", undefined, signal);
}

export { ApiError };

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

export async function apiFetch<T>(
	path: string,
	params?: Record<string, string>,
	signal?: AbortSignal,
	init?: RequestInit,
): Promise<T> {
	const url = new URL(`${API_BASE}${path}`, window.location.origin);
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			url.searchParams.set(k, v);
		}
	}

	const headers: Record<string, string> = {};
	if (init?.body) headers["Content-Type"] = "application/json";

	const res = await fetch(url.toString(), {
		signal,
		credentials: "same-origin",
		...init,
		headers: { ...headers, ...(init?.headers as Record<string, string>) },
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: res.statusText }));
		throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
	}

	return res.json() as Promise<T>;
}

// ─── Collection-scoped endpoints ────────────────────────────────────────────

const CID_PREFIX = "cid:";

function collectionPath(collection: string, endpoint: string): string {
	if (collection.startsWith(CID_PREFIX)) {
		const cid = collection.slice(CID_PREFIX.length);
		return `/api/collections/cid/${encodeURIComponent(cid)}/${endpoint}`;
	}
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

// ─── Wallet collection endpoints ─────────────────────────────────────────────

export interface WalletCollection {
	id: string;
	name: string;
	status: string;
	sourceCount: number;
	segmentCount: number | null;
	manifestCid: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface WalletCollectionDetail extends WalletCollection {
	pieceCid: string | null;
	sources: Array<{
		id: string;
		type: string;
		identifier: string;
		status: string;
		chunkCount: number | null;
		error: string | null;
	}>;
}

export function createCollection(
	name: string,
	sources: Array<{ type: string; identifier: string }>,
	signal?: AbortSignal,
): Promise<WalletCollectionDetail> {
	return apiFetch<WalletCollectionDetail>("/api/wallet-collections", undefined, signal, {
		method: "POST",
		body: JSON.stringify({ name, sources }),
	});
}

export function fetchMyCollections(
	signal?: AbortSignal,
): Promise<{ collections: WalletCollection[] }> {
	return apiFetch<{ collections: WalletCollection[] }>(
		"/api/wallet-collections",
		undefined,
		signal,
	);
}

export function fetchCollectionDetail(
	id: string,
	signal?: AbortSignal,
): Promise<WalletCollectionDetail> {
	return apiFetch<WalletCollectionDetail>(`/api/wallet-collections/${id}`, undefined, signal);
}

export function addSourcesToCollection(
	id: string,
	sources: Array<{ type: string; identifier: string }>,
	signal?: AbortSignal,
): Promise<{ sources: Array<{ id: string; type: string; identifier: string; status: string }> }> {
	return apiFetch(`/api/wallet-collections/${id}/sources`, undefined, signal, {
		method: "POST",
		body: JSON.stringify({ sources }),
	});
}

// ─── Auth session bootstrap ──────────────────────────────────────────────────

export interface SessionState {
	authenticated: boolean;
	address?: string;
	chainId?: number;
	sessionKeyActive?: boolean;
	sessionKeyExpiresAt?: string | null;
}

export function fetchSession(signal?: AbortSignal): Promise<SessionState> {
	return apiFetch<SessionState>("/api/auth/session", undefined, signal);
}

// ─── Session key + promote endpoints ─────────────────────────────────────────

export function delegateSessionKey(
	sessionKey: string,
	expiresAt: string,
	chainId: number,
	signal?: AbortSignal,
): Promise<{ sessionKeyActive: boolean; sessionKeyExpiresAt: string }> {
	return apiFetch("/api/auth/session-key", undefined, signal, {
		method: "POST",
		body: JSON.stringify({ sessionKey, expiresAt, chainId }),
	});
}

export function revokeSessionKey(
	signal?: AbortSignal,
): Promise<{ sessionKeyActive: boolean; sessionKeyAddress: string | null }> {
	return apiFetch("/api/auth/session-key", undefined, signal, { method: "DELETE" });
}

export function promoteCollection(
	id: string,
	signal?: AbortSignal,
): Promise<{ id: string; status: string; promoteCheckpoint: string | null }> {
	return apiFetch(`/api/wallet-collections/${id}/promote`, undefined, signal, {
		method: "POST",
	});
}

// ─── Jobs (#168) ─────────────────────────────────────────────────────────────

export interface JobView {
	id: string;
	type: string;
	collectionId: string | null;
	status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
	phase: string | null;
	current: number;
	total: number;
	message?: string | null;
	errorCode: string | null;
	errorMessage?: string | null;
	cancelRequestedAt: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	parentJobId: string | null;
	createdAt: string;
	updatedAt: string;
}

export function fetchJob(id: string, signal?: AbortSignal): Promise<{ job: JobView }> {
	return apiFetch(`/api/jobs/${id}`, undefined, signal);
}

export function fetchJobs(
	filter?: { collection?: string; status?: string },
	signal?: AbortSignal,
): Promise<{ jobs: JobView[] }> {
	const params: Record<string, string> = {};
	if (filter?.collection) params.collection = filter.collection;
	if (filter?.status) params.status = filter.status;
	return apiFetch("/api/jobs", Object.keys(params).length > 0 ? params : undefined, signal);
}

export function cancelJob(id: string, signal?: AbortSignal): Promise<void> {
	return apiFetch(`/api/jobs/${id}`, undefined, signal, { method: "DELETE" });
}

export function fetchPromoteStatus(
	id: string,
	signal?: AbortSignal,
): Promise<{
	status: string;
	checkpoint: string | null;
	manifestCid: string | null;
	pieceCid: string | null;
	carRootCid: string | null;
}> {
	return apiFetch(`/api/wallet-collections/${id}/promote/status`, undefined, signal);
}

export { ApiError };

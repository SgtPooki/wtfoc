/**
 * Thin client for the homelab vllm-admin mode-switch API. Maintainer-only.
 *
 * Single-GPU homelab box can serve exactly one of {chat, rerank-gpu,
 * embed-gpu} at a time. The autoresearch nightly cron drives the
 * switch around its phases (sweep → analyze → materialize → reset).
 *
 * Hard rules:
 *   - Gated by `WTFOC_VLLM_AUTOSWAP=1`. When unset every call is a noop
 *     so non-homelab maintainers can run the loop unmodified.
 *   - Admin URL comes from `WTFOC_VLLM_ADMIN_URL`. No homelab2 URLs
 *     hardcoded.
 *   - `ensureMode` is idempotent — same target as current activeMode
 *     short-circuits without a network call to switch (still polls
 *     `/admin/mode` once to read state).
 *   - Polls until terminal phase or until `timeoutMs` elapses. Terminal
 *     failure phases throw; the caller decides whether to abort the
 *     pipeline.
 *
 * See homelab2/docs/runbooks/vllm-admin-consumer-guide.md for the
 * server-side state machine.
 */

export type GpuMode = "chat" | "rerank-gpu" | "embed-gpu";

const TERMINAL_OK = new Set(["ChatActive", "RerankGpuActive", "EmbedGpuActive"]);
const TERMINAL_FAIL = new Set([
	"RolledBack",
	"Failed",
	"RollbackFailed",
	"WedgedManualRecoveryRequired",
]);

interface ModeStateEnvelope {
	state: {
		activeMode: GpuMode;
		modePhase: string;
		targetMode: GpuMode | null;
	};
	observedSteadyMode: GpuMode | null;
}

export interface EnsureModeOptions {
	/** Override admin base URL (defaults to env). Tests use this. */
	adminUrl?: string;
	/** Override fetch (tests). */
	fetchFn?: typeof fetch;
	/** Total deadline. Default 2400000ms (chat AEON cold-load worst case). */
	timeoutMs?: number;
	/** Poll interval while transient. Default 10000ms. */
	pollIntervalMs?: number;
	/** Reason string forwarded to admin for audit. */
	reason?: string;
	/** Override the autoswap gate (tests). */
	enabled?: boolean;
}

export interface EnsureModeResult {
	skipped: boolean;
	skippedReason?: string;
	from?: GpuMode;
	to?: GpuMode;
	finalPhase?: string;
}

function adminBaseUrl(opts: EnsureModeOptions): string | null {
	const fromOpt = opts.adminUrl;
	const fromEnv = process.env.WTFOC_VLLM_ADMIN_URL;
	const url = fromOpt ?? fromEnv ?? "";
	if (!url) return null;
	return url.replace(/\/+$/, "");
}

function isEnabled(opts: EnsureModeOptions): boolean {
	if (typeof opts.enabled === "boolean") return opts.enabled;
	return process.env.WTFOC_VLLM_AUTOSWAP === "1";
}

async function fetchMode(
	base: string,
	fetchFn: typeof fetch,
): Promise<ModeStateEnvelope> {
	const res = await fetchFn(`${base}/admin/mode`, { method: "GET" });
	if (!res.ok) {
		throw new Error(`GET /admin/mode failed: ${res.status} ${res.statusText}`);
	}
	return (await res.json()) as ModeStateEnvelope;
}

async function postSwitch(
	base: string,
	target: GpuMode,
	reason: string,
	fetchFn: typeof fetch,
	timeoutMs: number,
): Promise<void> {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	try {
		const res = await fetchFn(`${base}/admin/mode-switch`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ targetMode: target, reason }),
			signal: ac.signal,
		});
		// 200 noop or 200 success — both fine. 409 means in-flight or
		// manual-recovery; surface as a non-fatal poll-and-retry signal.
		if (res.status === 409) {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (body.error === "manual_recovery_required") {
				throw new Error("admin requires manual recovery (POST /admin/mode-reset first)");
			}
			// switch_in_flight / lease_held — caller polls.
			return;
		}
		if (!res.ok) {
			throw new Error(`POST /admin/mode-switch failed: ${res.status} ${res.statusText}`);
		}
	} finally {
		clearTimeout(timer);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Switch the homelab GPU to `target` and block until terminal. Noop
 * when WTFOC_VLLM_AUTOSWAP is not enabled or no admin URL is set.
 */
export async function ensureMode(
	target: GpuMode,
	opts: EnsureModeOptions = {},
): Promise<EnsureModeResult> {
	if (!isEnabled(opts)) {
		return { skipped: true, skippedReason: "WTFOC_VLLM_AUTOSWAP!=1" };
	}
	const base = adminBaseUrl(opts);
	if (!base) {
		return { skipped: true, skippedReason: "WTFOC_VLLM_ADMIN_URL unset" };
	}
	const fetchFn = opts.fetchFn ?? fetch;
	const timeoutMs = opts.timeoutMs ?? 2400000;
	const pollMs = opts.pollIntervalMs ?? 10000;
	const reason = opts.reason ?? "wtfoc-autoresearch";
	const deadline = Date.now() + timeoutMs;

	const initial = await fetchMode(base, fetchFn);
	const from = initial.state.activeMode;
	if (from === target && TERMINAL_OK.has(initial.state.modePhase)) {
		return { skipped: false, from, to: target, finalPhase: initial.state.modePhase };
	}

	await postSwitch(base, target, reason, fetchFn, timeoutMs);

	while (Date.now() < deadline) {
		const env = await fetchMode(base, fetchFn);
		const phase = env.state.modePhase;
		if (TERMINAL_OK.has(phase)) {
			if (env.state.activeMode !== target) {
				throw new Error(
					`mode-switch terminal-OK but activeMode=${env.state.activeMode} != target=${target}`,
				);
			}
			return { skipped: false, from, to: target, finalPhase: phase };
		}
		if (TERMINAL_FAIL.has(phase)) {
			throw new Error(`mode-switch terminal failure: ${phase} (target=${target})`);
		}
		await sleep(pollMs);
	}
	throw new Error(`mode-switch timeout after ${timeoutMs}ms (target=${target})`);
}

/**
 * Resolve the GPU phase a matrix needs for its sweep. Inspects whether
 * any URL in the matrix points at a homelab GPU-only endpoint. Returns
 * null when the matrix is fully always-on / cloud (no swap needed).
 *
 * Heuristic: looks for `embedder-gpu`, `reranker-gpu`, or
 * `vllm.bt.sgtpooki` substrings. Override via matrix.gpuPhase when
 * heuristic is wrong.
 */
export function resolveModeFromMatrix(matrix: {
	gpuPhase?: GpuMode | null;
	baseConfig: { embedderUrl?: string; extractorUrl?: string };
	axes: { reranker?: ReadonlyArray<unknown> };
}): GpuMode | null {
	if (matrix.gpuPhase !== undefined) return matrix.gpuPhase;
	const urls: string[] = [];
	if (matrix.baseConfig.embedderUrl) urls.push(matrix.baseConfig.embedderUrl);
	if (matrix.baseConfig.extractorUrl) urls.push(matrix.baseConfig.extractorUrl);
	for (const r of matrix.axes.reranker ?? []) {
		if (r && typeof r === "object" && "url" in r && typeof (r as { url: string }).url === "string") {
			urls.push((r as { url: string }).url);
		}
	}
	for (const u of urls) {
		if (u.includes("embedder-gpu")) return "embed-gpu";
		if (u.includes("reranker-gpu")) return "rerank-gpu";
	}
	return null;
}

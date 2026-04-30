import { describe, expect, it, vi } from "vitest";
import { ensureMode, resolveModeFromMatrix } from "./mode-switch.js";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function buildState(activeMode: string, modePhase: string): unknown {
	return {
		state: { activeMode, modePhase, targetMode: null },
		observedSteadyMode: activeMode,
	};
}

describe("ensureMode", () => {
	it("noop when WTFOC_VLLM_AUTOSWAP not set", async () => {
		const fetchFn = vi.fn();
		const r = await ensureMode("chat", {
			adminUrl: "http://admin",
			fetchFn: fetchFn as unknown as typeof fetch,
			enabled: false,
		});
		expect(r.skipped).toBe(true);
		expect(r.skippedReason).toMatch(/AUTOSWAP/);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("noop when admin URL missing", async () => {
		const fetchFn = vi.fn();
		const r = await ensureMode("chat", {
			adminUrl: "",
			fetchFn: fetchFn as unknown as typeof fetch,
			enabled: true,
		});
		expect(r.skipped).toBe(true);
		expect(r.skippedReason).toMatch(/ADMIN_URL/);
	});

	it("idempotent short-circuit when already in target mode", async () => {
		const fetchFn = vi.fn(async () =>
			jsonResponse(buildState("chat", "ChatActive")),
		);
		const r = await ensureMode("chat", {
			adminUrl: "http://admin",
			fetchFn: fetchFn as unknown as typeof fetch,
			enabled: true,
		});
		expect(r.skipped).toBe(false);
		expect(r.from).toBe("chat");
		expect(r.to).toBe("chat");
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("polls until terminal-OK after switch POST", async () => {
		const seq: Response[] = [
			jsonResponse(buildState("chat", "ChatActive")), // initial
			jsonResponse({ operationId: "x", from: "chat", to: "rerank-gpu" }), // POST
			jsonResponse(buildState("chat", "Switching:Draining")), // poll 1
			jsonResponse(buildState("rerank-gpu", "Switching:Loading")), // poll 2
			jsonResponse(buildState("rerank-gpu", "RerankGpuActive")), // poll 3 terminal
		];
		const fetchFn = vi.fn(async () => seq.shift() ?? jsonResponse({}));
		const r = await ensureMode("rerank-gpu", {
			adminUrl: "http://admin",
			fetchFn: fetchFn as unknown as typeof fetch,
			enabled: true,
			pollIntervalMs: 1,
			timeoutMs: 5000,
		});
		expect(r.skipped).toBe(false);
		expect(r.to).toBe("rerank-gpu");
		expect(r.finalPhase).toBe("RerankGpuActive");
	});

	it("throws on terminal-failure phase", async () => {
		const seq: Response[] = [
			jsonResponse(buildState("chat", "ChatActive")),
			jsonResponse({ operationId: "x" }),
			jsonResponse(buildState("chat", "RollbackFailed")),
		];
		const fetchFn = vi.fn(async () => seq.shift() ?? jsonResponse({}));
		await expect(
			ensureMode("rerank-gpu", {
				adminUrl: "http://admin",
				fetchFn: fetchFn as unknown as typeof fetch,
				enabled: true,
				pollIntervalMs: 1,
				timeoutMs: 5000,
			}),
		).rejects.toThrow(/terminal failure/);
	});

	it("throws on manual-recovery 409", async () => {
		const seq: Response[] = [
			jsonResponse(buildState("chat", "ChatActive")),
			jsonResponse({ error: "manual_recovery_required" }, 409),
		];
		const fetchFn = vi.fn(async () => seq.shift() ?? jsonResponse({}));
		await expect(
			ensureMode("rerank-gpu", {
				adminUrl: "http://admin",
				fetchFn: fetchFn as unknown as typeof fetch,
				enabled: true,
				pollIntervalMs: 1,
				timeoutMs: 5000,
			}),
		).rejects.toThrow(/manual recovery/);
	});

	it("times out when phase stays transient", async () => {
		const fetchFn = vi.fn(async (input: string | URL | Request) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/admin/mode-switch")) {
				return jsonResponse({ operationId: "x" });
			}
			return jsonResponse(buildState("chat", "Switching:Loading"));
		});
		await expect(
			ensureMode("rerank-gpu", {
				adminUrl: "http://admin",
				fetchFn: fetchFn as unknown as typeof fetch,
				enabled: true,
				pollIntervalMs: 1,
				timeoutMs: 30,
			}),
		).rejects.toThrow(/timeout/);
	});
});

describe("resolveModeFromMatrix", () => {
	it("returns explicit gpuPhase when set", () => {
		expect(
			resolveModeFromMatrix({
				gpuPhase: "rerank-gpu",
				baseConfig: {},
				axes: {},
			}),
		).toBe("rerank-gpu");
	});

	it("returns null when gpuPhase explicitly null", () => {
		expect(
			resolveModeFromMatrix({
				gpuPhase: null,
				baseConfig: { embedderUrl: "http://embedder-gpu.x/v1" },
				axes: {},
			}),
		).toBe(null);
	});

	it("detects embed-gpu via URL substring", () => {
		expect(
			resolveModeFromMatrix({
				baseConfig: { embedderUrl: "http://embedder-gpu.example/v1" },
				axes: {},
			}),
		).toBe("embed-gpu");
	});

	it("detects rerank-gpu via reranker URL", () => {
		expect(
			resolveModeFromMatrix({
				baseConfig: {},
				axes: { reranker: [{ type: "bge", url: "http://reranker-gpu.x" }] },
			}),
		).toBe("rerank-gpu");
	});

	it("returns null for cloud-only matrices", () => {
		expect(
			resolveModeFromMatrix({
				baseConfig: { embedderUrl: "https://openrouter.ai/api/v1" },
				axes: { reranker: ["off", { type: "llm", url: "http://127.0.0.1:4523/v1" }] },
			}),
		).toBe(null);
	});
});

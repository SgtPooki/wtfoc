#!/usr/bin/env tsx
/**
 * Phase 4 cron preflight. Maintainer-only.
 *
 * Probes the local services the autoresearch sweep depends on. On any
 * failure, exits with code 75 (EX_TEMPFAIL) so the wrapper can mark
 * the night as DEGRADED without confusing it for a quality regression
 * or a sweep crash.
 *
 * Probes:
 *   - Embedder URL / models (OPENROUTER_API_KEY required, must respond
 *     to a HEAD or /models request).
 *   - Extractor URL / models (local Claude direct proxy, no auth).
 *   - Optional: BGE reranker URL (/healthz), only when
 *     WTFOC_REQUIRE_RERANKER=1.
 *
 * Writes a status JSON to `~/.wtfoc/autoresearch/nightly-status.json`
 * with the result of every probe so the maintainer can tail it.
 *
 * No homelab2 endpoints are hardcoded — every URL comes from env.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface ProbeResult {
	name: string;
	ok: boolean;
	status?: number;
	durationMs: number;
	url: string;
	error?: string;
	skipped?: boolean;
	reason?: string;
}

interface PreflightStatus {
	checkedAt: string;
	ok: boolean;
	degraded: string[];
	probes: ProbeResult[];
}

async function probe(name: string, url: string, opts: { timeoutMs?: number } = {}): Promise<ProbeResult> {
	const t0 = performance.now();
	const ac = new AbortController();
	const timeoutMs = opts.timeoutMs ?? 5000;
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	try {
		const res = await fetch(url, { method: "GET", signal: ac.signal });
		const durationMs = performance.now() - t0;
		if (!res.ok) {
			return { name, ok: false, status: res.status, durationMs, url };
		}
		return { name, ok: true, status: res.status, durationMs, url };
	} catch (err) {
		const durationMs = performance.now() - t0;
		return {
			name,
			ok: false,
			durationMs,
			url,
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		clearTimeout(timer);
	}
}

function statusPath(): string {
	const baseDir =
		process.env.WTFOC_AUTORESEARCH_DIR ?? `${process.env.HOME}/.wtfoc/autoresearch`;
	return join(baseDir, "nightly-status.json");
}

function readUrls() {
	const embedderBase = process.env.WTFOC_EMBEDDER_URL ?? "https://openrouter.ai/api/v1";
	const extractorBase = process.env.WTFOC_EXTRACTOR_URL ?? "http://127.0.0.1:4523/v1";
	const rerankerBase = process.env.WTFOC_RERANKER_URL ?? "http://127.0.0.1:8386";
	const requireReranker = process.env.WTFOC_REQUIRE_RERANKER === "1";
	return { embedderBase, extractorBase, rerankerBase, requireReranker };
}

async function main(): Promise<void> {
	const { embedderBase, extractorBase, rerankerBase, requireReranker } = readUrls();

	const probes: ProbeResult[] = [];

	// Embedder — /models if reachable, otherwise base URL.
	const embedderUrl = `${embedderBase.replace(/\/+$/, "")}/models`;
	if (!process.env.OPENROUTER_API_KEY) {
		probes.push({
			name: "openrouter-key",
			ok: false,
			url: "(env)",
			durationMs: 0,
			error: "OPENROUTER_API_KEY not set",
		});
	} else {
		probes.push({
			name: "openrouter-key",
			ok: true,
			url: "(env)",
			durationMs: 0,
		});
	}
	probes.push(await probe("embedder", embedderUrl, { timeoutMs: 8000 }));
	probes.push(await probe("extractor", `${extractorBase.replace(/\/+$/, "")}/models`));

	if (requireReranker) {
		probes.push(await probe("reranker", `${rerankerBase.replace(/\/+$/, "")}/healthz`));
	} else {
		probes.push({
			name: "reranker",
			ok: true,
			url: rerankerBase,
			durationMs: 0,
			skipped: true,
			reason: "WTFOC_REQUIRE_RERANKER!=1",
		});
	}

	const failed = probes.filter((p) => !p.ok);
	const status: PreflightStatus = {
		checkedAt: new Date().toISOString(),
		ok: failed.length === 0,
		degraded: failed.map((p) => p.name),
		probes,
	};

	const path = statusPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(status, null, 2));

	for (const p of probes) {
		if (p.skipped) {
			console.error(`[preflight] SKIP ${p.name} (${p.reason})`);
			continue;
		}
		const tag = p.ok ? "OK  " : "FAIL";
		const dur = `${p.durationMs.toFixed(0)}ms`;
		const detail = p.ok ? `${p.status ?? "—"}` : p.error ?? `${p.status ?? "?"}`;
		console.error(`[preflight] ${tag} ${p.name.padEnd(16)} ${dur.padStart(7)} ${detail}`);
	}

	if (!status.ok) {
		console.error(`[preflight] DEGRADED — ${failed.length} probe(s) failed`);
		process.exit(75);
	}
	console.error("[preflight] OK");
}

main().catch((err) => {
	console.error("[preflight] fatal:", err instanceof Error ? err.message : String(err));
	process.exit(1);
});

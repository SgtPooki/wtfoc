import type { StorageBackend, StorageResult } from "@wtfoc/common";
import { StorageNotFoundError, StorageUnreachableError, WtfocError } from "@wtfoc/common";

const IPFS_GATEWAYS = ["https://dweb.link/ipfs/", "https://trustless-gateway.link/ipfs/"];
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;

type VerifiedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Constructor options for `CidReadableStorage`. Tests pass a pre-built
 * verified-fetch backed by an offline Helia node; production leaves this
 * undefined so the default network-capable instance is lazily constructed.
 */
export interface CidReadableStorageOptions {
	/** Preconfigured verified-fetch — skips the lazy default init. */
	verifiedFetch?: VerifiedFetch;
	/**
	 * Hard per-download timeout in ms. When verified-fetch is in use and a
	 * single call exceeds this, the call is aborted and the download
	 * retries through the HTTP gateway fallback. Default 120000 (2 min).
	 * Set `0` or `Infinity` to disable — useful in tests that provide their
	 * own deterministic `verifiedFetch`.
	 */
	downloadTimeoutMs?: number;
}

/**
 * Read-only storage backend that fetches artifacts by CID via IPFS gateways.
 * Tries @helia/verified-fetch first (P2P + verified retrieval), falls back to
 * public HTTP gateways when verified-fetch is unavailable (e.g., Docker images
 * without native node-datachannel).
 *
 * This backend is read-only — upload() always throws. IPFS is retrieval-only;
 * writes go through FOC via FocStorageBackend.
 */
export class CidReadableStorage implements StorageBackend {
	#verifiedFetch: VerifiedFetch | null;
	#initPromise: Promise<void> | null = null;
	#useGatewayFallback = false;
	readonly #downloadTimeoutMs: number;
	/**
	 * Holds the helia handle built by {@link buildDefaultVerifiedFetch} so
	 * {@link close} can shut it down. Tests that inject a `verifiedFetch`
	 * own their own lifecycle and this stays null.
	 */
	#ownedHelia: { stop(): Promise<void> } | null = null;

	constructor(options: CidReadableStorageOptions = {}) {
		this.#verifiedFetch = options.verifiedFetch ?? null;
		this.#downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
	}

	/**
	 * Stop any internally-owned helia instance. Idempotent. Callers that
	 * use this storage (CLI commands, scripts, long-running services) must
	 * invoke this before exit or the helia libp2p node keeps the process
	 * alive for minutes waiting for its own shutdown timers.
	 */
	async close(): Promise<void> {
		const helia = this.#ownedHelia;
		this.#ownedHelia = null;
		if (!helia) return;
		try {
			await helia.stop();
		} catch {
			// shutdown errors on a read-only reader are non-fatal; swallow
		}
	}

	async #ensureReady(): Promise<void> {
		if (this.#verifiedFetch || this.#useGatewayFallback) return;
		if (!this.#initPromise) {
			this.#initPromise = (async () => {
				try {
					const built = await buildDefaultVerifiedFetch();
					this.#verifiedFetch = built.verifiedFetch;
					this.#ownedHelia = built.helia;
				} catch (err) {
					// verified-fetch unavailable at import time OR at Helia start
					// (e.g. node-datachannel native crash, missing WebRTC UDP) →
					// fall back to public HTTP gateways. See wtfoc-u4i2.
					console.error(
						"[cid-reader] verified-fetch init failed, using HTTP gateway fallback:",
						err instanceof Error ? err.message : err,
					);
					this.#useGatewayFallback = true;
				}
			})();
		}
		await this.#initPromise;
	}

	async download(cid: string, signal?: AbortSignal): Promise<Uint8Array> {
		signal?.throwIfAborted();
		await this.#ensureReady();

		// Try verified-fetch first if available. Enforce a hard per-call
		// timeout because helia/verified-fetch has no internal cap and can
		// stall indefinitely on provider discovery — caller-supplied retry
		// logic is useless outside a request that never returns. On timeout
		// or any recoverable error, fall through to the HTTP gateway path.
		if (this.#verifiedFetch) {
			const vfResult = await this.#tryVerifiedFetch(cid, signal);
			if (vfResult.kind === "ok") return vfResult.bytes;
			if (vfResult.kind === "not-found") throw new StorageNotFoundError(cid, "ipfs");
			// kind === "retry-elsewhere" → continue to gateway fallback
		}

		return this.#downloadViaGateways(cid, signal);
	}

	async #tryVerifiedFetch(
		cid: string,
		signal?: AbortSignal,
	): Promise<
		{ kind: "ok"; bytes: Uint8Array } | { kind: "not-found" } | { kind: "retry-elsewhere" }
	> {
		const controller = new AbortController();
		const externalAbort = () => controller.abort(signal?.reason);
		signal?.addEventListener("abort", externalAbort);
		const timer =
			this.#downloadTimeoutMs > 0 && Number.isFinite(this.#downloadTimeoutMs)
				? setTimeout(
						() => controller.abort(new Error("verified-fetch timeout")),
						this.#downloadTimeoutMs,
					)
				: null;
		try {
			const response = await this.#verifiedFetch!(`ipfs://${cid}`, { signal: controller.signal });
			if (response.status === 404) return { kind: "not-found" };
			if (!response.ok) return { kind: "retry-elsewhere" };
			const buffer = await response.arrayBuffer();
			return { kind: "ok", bytes: new Uint8Array(buffer) };
		} catch (err) {
			if (signal?.aborted) throw err;
			return { kind: "retry-elsewhere" };
		} finally {
			if (timer) clearTimeout(timer);
			signal?.removeEventListener("abort", externalAbort);
		}
	}

	async #downloadViaGateways(cid: string, signal?: AbortSignal): Promise<Uint8Array> {
		const errors: Error[] = [];
		for (const gateway of IPFS_GATEWAYS) {
			try {
				const response = await fetch(`${gateway}${cid}`, {
					signal,
					headers: { Accept: "application/octet-stream, application/json, */*" },
				});
				if (response.status === 404) continue;
				if (!response.ok) continue;
				const buffer = await response.arrayBuffer();
				return new Uint8Array(buffer);
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") throw err;
				errors.push(err instanceof Error ? err : new Error(String(err)));
			}
		}

		throw new StorageUnreachableError(
			"ipfs",
			new Error(
				`All IPFS gateways failed for CID ${cid}: ${errors.map((e) => e.message).join(", ")}`,
			),
		);
	}

	async upload(): Promise<StorageResult> {
		throw new WtfocError(
			"CidReadableStorage is read-only — use FocStorageBackend for writes",
			"CID_READ_ONLY",
		);
	}
}

/**
 * Construct a verified-fetch backed by a Helia node with transports limited to
 * TCP + WebSockets + circuit-relay. Dropping `@libp2p/webrtc` + webrtc-direct
 * avoids a `node-datachannel` native crash observed on macOS where the ICE
 * UDP mux fails to bind (wtfoc-u4i2). Bitswap + DHT routing over TCP is
 * sufficient for verified retrieval.
 */
async function buildDefaultVerifiedFetch(): Promise<{
	verifiedFetch: VerifiedFetch;
	helia: { stop(): Promise<void> };
}> {
	const [{ createHelia, libp2pDefaults }, { createVerifiedFetch }] = await Promise.all([
		import("helia"),
		import("@helia/verified-fetch"),
	]);

	const defaults = libp2pDefaults();
	// Drop webrtc + webrtc-direct. libp2pDefaults returns a mixed array of
	// transport factories; filter by looking at the factory's `name` tag
	// exported on each transport.
	defaults.transports = (defaults.transports ?? []).filter((factory) => {
		const tag = (factory as { name?: string }).name ?? "";
		return !/webrtc/i.test(String(tag));
	});
	// Also strip transport listen addresses that reference the dropped transports
	// so libp2p doesn't try to listen on /webrtc-direct.
	if (defaults.addresses?.listen) {
		defaults.addresses.listen = defaults.addresses.listen.filter((ma) => !/webrtc/i.test(ma));
	}
	// Drop services that bring in native deps / network side effects we don't
	// need for read-only retrieval.
	if (defaults.services) {
		delete (defaults.services as Record<string, unknown>).autoTLS;
		delete (defaults.services as Record<string, unknown>).upnp;
	}

	const helia = await createHelia({ libp2p: defaults });
	const verifiedFetch = await createVerifiedFetch(helia);
	return { verifiedFetch, helia };
}

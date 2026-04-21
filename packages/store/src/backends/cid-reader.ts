import type { StorageBackend, StorageResult } from "@wtfoc/common";
import { StorageNotFoundError, StorageUnreachableError, WtfocError } from "@wtfoc/common";

const IPFS_GATEWAYS = ["https://dweb.link/ipfs/", "https://trustless-gateway.link/ipfs/"];

type VerifiedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Constructor options for `CidReadableStorage`. Tests pass a pre-built
 * verified-fetch backed by an offline Helia node; production leaves this
 * undefined so the default network-capable instance is lazily constructed.
 */
export interface CidReadableStorageOptions {
	/** Preconfigured verified-fetch — skips the lazy default init. */
	verifiedFetch?: VerifiedFetch;
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

	constructor(options: CidReadableStorageOptions = {}) {
		this.#verifiedFetch = options.verifiedFetch ?? null;
	}

	async #ensureReady(): Promise<void> {
		if (this.#verifiedFetch || this.#useGatewayFallback) return;
		if (!this.#initPromise) {
			this.#initPromise = (async () => {
				try {
					const vf = await buildDefaultVerifiedFetch();
					this.#verifiedFetch = vf;
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

		// Try verified-fetch first if available
		if (this.#verifiedFetch) {
			let response: Response;
			try {
				response = await this.#verifiedFetch(`ipfs://${cid}`, { signal });
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") throw err;
				throw new StorageUnreachableError("ipfs", err);
			}

			if (response.status === 404) {
				throw new StorageNotFoundError(cid, "ipfs");
			}
			if (!response.ok) {
				throw new StorageUnreachableError("ipfs", new Error(`HTTP ${response.status} for ${cid}`));
			}

			const buffer = await response.arrayBuffer();
			return new Uint8Array(buffer);
		}

		// HTTP gateway fallback
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
async function buildDefaultVerifiedFetch(): Promise<VerifiedFetch> {
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
	return createVerifiedFetch(helia);
}

import type { StorageBackend, StorageResult } from "@wtfoc/common";
import { StorageNotFoundError, StorageUnreachableError, WtfocError } from "@wtfoc/common";

const IPFS_GATEWAYS = [
	"https://dweb.link/ipfs/",
	"https://trustless-gateway.link/ipfs/",
];

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
	#verifiedFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
	#initPromise: Promise<void> | null = null;
	#useGatewayFallback = false;

	async #ensureReady(): Promise<void> {
		if (this.#verifiedFetch || this.#useGatewayFallback) return;
		if (!this.#initPromise) {
			this.#initPromise = (async () => {
				try {
					const mod = await import("@helia/verified-fetch");
					const vf = await mod.createVerifiedFetch();
					this.#verifiedFetch = vf;
				} catch {
					// verified-fetch unavailable (missing native deps) — use HTTP gateways
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
			new Error(`All IPFS gateways failed for CID ${cid}: ${errors.map((e) => e.message).join(", ")}`),
		);
	}

	async upload(): Promise<StorageResult> {
		throw new WtfocError(
			"CidReadableStorage is read-only — use FocStorageBackend for writes",
			"CID_READ_ONLY",
		);
	}
}

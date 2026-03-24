import type { StorageBackend, StorageResult } from "@wtfoc/common";
import { StorageNotFoundError, StorageUnreachableError, WtfocError } from "@wtfoc/common";

/**
 * Read-only storage backend that fetches artifacts by CID via IPFS gateways.
 * Uses @helia/verified-fetch for verified, parallel retrieval with gateway fallback.
 *
 * This backend is read-only — upload() always throws. IPFS is retrieval-only;
 * writes go through FOC via FocStorageBackend.
 */
export class CidReadableStorage implements StorageBackend {
	#verifiedFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
	#initPromise: Promise<void> | null = null;

	async #ensureReady(): Promise<void> {
		if (this.#verifiedFetch) return;
		if (!this.#initPromise) {
			this.#initPromise = (async () => {
				try {
					const mod = await import("@helia/verified-fetch");
					const vf = await mod.createVerifiedFetch();
					this.#verifiedFetch = vf;
				} catch (err) {
					this.#initPromise = null;
					throw new WtfocError(
						`Failed to initialize verified-fetch: ${err instanceof Error ? err.message : String(err)}`,
						"CID_INIT_FAILED",
						{ cause: err },
					);
				}
			})();
		}
		await this.#initPromise;
	}

	async download(cid: string, signal?: AbortSignal): Promise<Uint8Array> {
		signal?.throwIfAborted();
		await this.#ensureReady();

		const vf = this.#verifiedFetch;
		if (!vf) throw new WtfocError("verified-fetch not initialized", "CID_INIT_FAILED");

		let response: Response;
		try {
			response = await vf(`ipfs://${cid}`, { signal });
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

	async upload(): Promise<StorageResult> {
		throw new WtfocError(
			"CidReadableStorage is read-only — use FocStorageBackend for writes",
			"CID_READ_ONLY",
		);
	}
}

import type { StorageBackend, StorageResult } from "@wtfoc/common";
import {
	StorageInsufficientBalanceError,
	StorageNotFoundError,
	StorageUnreachableError,
} from "@wtfoc/common";

// Minimum piece size enforced by SPs (127 bytes observed on calibration)
const MIN_PIECE_SIZE = 127;

export interface FocStorageBackendOptions {
	/** Wallet private key (hex string starting with 0x) */
	privateKey: string;
	/** Network: 'calibration' or 'mainnet' (default: calibration) */
	network?: "calibration" | "mainnet";
	/** Synapse source namespace (default: 'wtfoc') */
	source?: string;
}

// Lazy-loaded types to avoid pulling heavy deps for local-only users
type SynapseInstance = Awaited<ReturnType<typeof import("filecoin-pin").initializeSynapse>>;

/**
 * FOC storage backend using filecoin-pin for CAR creation + synapse-sdk for storage.
 * Produces BOTH PieceCID (FOC) and IPFS CID (gateway-accessible) for every upload.
 *
 * id = PieceCID (durable, content-addressed)
 * ipfsCid = IPFS root CID (gateway-accessible via dweb.link)
 */
export class FocStorageBackend implements StorageBackend {
	#synapse: SynapseInstance | null = null;
	#initPromise: Promise<void> | null = null;
	readonly #privateKey: string;
	readonly #network: "calibration" | "mainnet";
	readonly #source: string;

	constructor(options: FocStorageBackendOptions) {
		this.#privateKey = options.privateKey;
		this.#network = options.network ?? "calibration";
		this.#source = options.source ?? "wtfoc";
	}

	async #ensureReady(): Promise<void> {
		if (this.#synapse) return;
		if (!this.#initPromise) {
			this.#initPromise = (async () => {
				try {
					const { initializeSynapse } = await import("filecoin-pin");
					this.#synapse = await initializeSynapse({
						privateKey: this.#privateKey,
						chainId: this.#network === "mainnet" ? 314 : 314159,
					});
				} catch (err) {
					this.#initPromise = null;
					throw new StorageUnreachableError("foc", err);
				}
			})();
		}
		await this.#initPromise;
	}

	#getSynapse(): SynapseInstance {
		if (!this.#synapse) {
			throw new StorageUnreachableError("foc", new Error("Not initialized"));
		}
		return this.#synapse;
	}

	async upload(
		data: Uint8Array,
		_metadata?: Record<string, string>,
		signal?: AbortSignal,
	): Promise<StorageResult> {
		signal?.throwIfAborted();
		await this.#ensureReady();
		const synapse = this.#getSynapse();

		if (data.byteLength < MIN_PIECE_SIZE) {
			throw new StorageUnreachableError(
				"foc",
				new Error(
					`Data size ${data.byteLength} bytes is below minimum ${MIN_PIECE_SIZE} bytes. Bundle into a larger blob.`,
				),
			);
		}

		try {
			const { createCarFromFile, executeUpload } = await import("filecoin-pin");

			// Create CAR file for dual CIDs (IPFS + PieceCID)
			const car = await createCarFromFile(new File([data], "segment.json"));
			const ipfsCid = car.rootCid.toString();

			// Minimal logger (filecoin-pin requires one)
			const logger = {
				info: () => {},
				debug: () => {},
				warn: (msg: unknown) => console.error("[foc-warn]", msg),
				error: (msg: unknown) => console.error("[foc-error]", msg),
			};

			// Upload CAR to FOC
			const result = await executeUpload(synapse, car.carBytes, car.rootCid, {
				copies: 2,
				logger,
			});

			const pieceCid = result.pieceCid?.toString();
			if (!pieceCid) {
				throw new Error("Upload succeeded but no PieceCID returned");
			}

			return {
				id: pieceCid,
				pieceCid,
				ipfsCid,
			};
		} catch (err) {
			if (err instanceof StorageUnreachableError) throw err;
			if (err instanceof StorageInsufficientBalanceError) throw err;

			const message = err instanceof Error ? err.message : String(err);
			if (message.includes("insufficient") || message.includes("balance")) {
				throw new StorageInsufficientBalanceError("foc", err);
			}
			throw new StorageUnreachableError("foc", err);
		}
	}

	async download(id: string, signal?: AbortSignal): Promise<Uint8Array> {
		signal?.throwIfAborted();
		await this.#ensureReady();

		try {
			// Try downloading via synapse-sdk (PieceCID)
			const { Synapse } = await import("@filoz/synapse-sdk");
			const { privateKeyToAccount } = await import("viem/accounts");
			const { http } = await import("viem");
			const chains = await import("@filoz/synapse-core/chains");

			const chain = this.#network === "mainnet" ? chains.mainnet : chains.calibration;
			const account = privateKeyToAccount(this.#privateKey as `0x${string}`);
			const synapse = Synapse.create({ account, chain, transport: http(), source: this.#source });

			const data = await synapse.storage.download({ pieceCid: id });
			return new Uint8Array(data);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes("not found") || message.includes("404")) {
				throw new StorageNotFoundError(id, "foc");
			}
			throw new StorageUnreachableError("foc", err);
		}
	}

	async verify(id: string, signal?: AbortSignal): Promise<{ exists: boolean; size: number }> {
		signal?.throwIfAborted();
		try {
			const data = await this.download(id, signal);
			return { exists: true, size: data.byteLength };
		} catch (err) {
			if (err instanceof StorageNotFoundError) {
				return { exists: false, size: 0 };
			}
			throw err;
		}
	}
}

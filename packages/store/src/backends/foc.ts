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

/**
 * FOC storage backend using @filoz/synapse-sdk.
 * Stores blobs on Filecoin Onchain Cloud with dual CIDs.
 *
 * id = PieceCID (durable, content-addressed, survives process restarts)
 */
export class FocStorageBackend implements StorageBackend {
	#synapse: ReturnType<typeof import("@filoz/synapse-sdk").Synapse.create> | null = null;
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
					const { Synapse } = await import("@filoz/synapse-sdk");
					const { privateKeyToAccount } = await import("viem/accounts");
					const { http } = await import("viem");
					const chains = await import("@filoz/synapse-core/chains");

					const chain = this.#network === "mainnet" ? chains.mainnet : chains.calibration;
					const account = privateKeyToAccount(this.#privateKey as `0x${string}`);

					this.#synapse = Synapse.create({
						account,
						chain,
						transport: http(),
						source: this.#source,
					});
				} catch (err) {
					this.#initPromise = null;
					throw new StorageUnreachableError("foc", err);
				}
			})();
		}
		await this.#initPromise;
	}

	#getSynapse() {
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

		// Validate size
		if (data.byteLength < MIN_PIECE_SIZE) {
			throw new StorageUnreachableError(
				"foc",
				new Error(
					`Data size ${data.byteLength} bytes is below minimum ${MIN_PIECE_SIZE} bytes. Bundle into a larger blob.`,
				),
			);
		}

		try {
			// Prepare payment if needed
			const prep = await synapse.storage.prepare({ dataSize: BigInt(data.byteLength) });
			if (prep.transaction) {
				await prep.transaction.execute();
			}

			// Upload
			const result = await synapse.storage.upload(data);
			const pieceCid = result.pieceCid?.toString();

			if (!pieceCid) {
				throw new Error("Upload succeeded but no PieceCID returned");
			}

			return {
				id: pieceCid,
				pieceCid,
				// TODO: get IPFS CID from filecoin-pin CAR creation (#41)
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
		const synapse = this.#getSynapse();

		try {
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

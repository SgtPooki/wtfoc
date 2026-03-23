import type { StorageBackend, StorageResult } from "@wtfoc/common";
import {
	StorageInsufficientBalanceError,
	StorageNotFoundError,
	StorageUnreachableError,
} from "@wtfoc/common";

const MIN_PIECE_SIZE = 127;

export interface FocStorageBackendOptions {
	privateKey: string;
	network?: "calibration" | "mainnet";
	source?: string;
}

/**
 * FOC storage backend using filecoin-pin for CAR creation + synapse-sdk.
 * Produces BOTH PieceCID (FOC) and IPFS CID (gateway-accessible).
 */
export class FocStorageBackend implements StorageBackend {
	readonly #privateKey: `0x${string}`;
	readonly #network: "calibration" | "mainnet";
	readonly #source: string;

	constructor(options: FocStorageBackendOptions) {
		if (!options.privateKey.startsWith("0x")) {
			throw new Error("Private key must start with 0x");
		}
		this.#privateKey = options.privateKey as `0x${string}`;
		this.#network = options.network ?? "calibration";
		this.#source = options.source ?? "wtfoc";
	}

	async upload(
		data: Uint8Array,
		_metadata?: Record<string, string>,
		signal?: AbortSignal,
	): Promise<StorageResult> {
		signal?.throwIfAborted();

		if (data.byteLength < MIN_PIECE_SIZE) {
			throw new StorageUnreachableError(
				"foc",
				new Error(`Data size ${data.byteLength} bytes is below minimum ${MIN_PIECE_SIZE} bytes.`),
			);
		}

		try {
			const fp = await import("filecoin-pin");
			const chains = await import("@filoz/synapse-core/chains");

			const chain = this.#network === "mainnet" ? chains.mainnet : chains.calibration;

			// Initialize synapse via filecoin-pin
			const synapse = await fp.initializeSynapse({
				privateKey: this.#privateKey,
				chain,
			});

			// Create CAR for dual CIDs
			const file = new File([Buffer.from(data)], "segment.json", { type: "application/json" });
			const car = await fp.createCarFromFile(file, { bare: true });
			const ipfsCid = car.rootCid.toString();

			// Create silent pino logger (required by filecoin-pin)
			const pino = await import("pino");
			const logger = pino.default({ level: "silent" });

			// Upload
			const result = await fp.executeUpload(synapse, car.carBytes, car.rootCid, {
				logger,
			});

			const pieceCid = result.pieceCid?.toString();
			if (!pieceCid) {
				throw new Error("Upload succeeded but no PieceCID returned");
			}

			// Use ipfsCid as the primary id for retrieval (returns unwrapped content)
			// PieceCID returns the CAR container which needs parsing
			return { id: ipfsCid, pieceCid, ipfsCid };
		} catch (err) {
			if (err instanceof StorageUnreachableError) throw err;
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes("insufficient") || message.includes("balance")) {
				throw new StorageInsufficientBalanceError("foc", err);
			}
			throw new StorageUnreachableError("foc", err);
		}
	}

	async download(id: string, signal?: AbortSignal): Promise<Uint8Array> {
		signal?.throwIfAborted();

		// Try public IPFS gateways first (works for any IPFS CID, returns content)
		const gateways = ["https://dweb.link/ipfs/", "https://inbrowser.link/ipfs/"];
		for (const gateway of gateways) {
			try {
				const response = await fetch(`${gateway}${id}`, { signal });
				if (response.ok) {
					return new Uint8Array(await response.arrayBuffer());
				}
			} catch {
				// Try next gateway
			}
		}

		// Fall back to synapse-sdk direct download (PieceCID)
		try {
			const { Synapse } = await import("@filoz/synapse-sdk");
			const { privateKeyToAccount } = await import("viem/accounts");
			const { http } = await import("viem");
			const chains = await import("@filoz/synapse-core/chains");

			const chain = this.#network === "mainnet" ? chains.mainnet : chains.calibration;
			const account = privateKeyToAccount(this.#privateKey);
			const synapse = Synapse.create({
				account,
				chain,
				transport: http(),
				source: this.#source,
			});

			// Try downloading with the id as pieceCid
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

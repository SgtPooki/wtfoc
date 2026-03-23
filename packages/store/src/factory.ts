import type { ManifestStore, StorageBackend } from "@wtfoc/common";
import { LocalStorageBackend } from "./backends/local.js";
import { LocalManifestStore } from "./manifest/local.js";

export interface StoreConfig {
	/** Storage backend: 'local', 'foc', or a custom StorageBackend instance */
	storage: "local" | "foc" | StorageBackend;
	/** Manifest store: defaults to LocalManifestStore. Provide custom instance to override. */
	manifests?: ManifestStore;
	/** Data directory for local storage backend (default: ~/.wtfoc/data) */
	dataDir?: string;
	/** Manifest directory for local manifest store (default: ~/.wtfoc/projects) */
	manifestDir?: string;
	/** FOC wallet private key (required for 'foc' backend) */
	privateKey?: string;
	/** FOC network: 'calibration' or 'mainnet' (default: 'calibration') */
	network?: "calibration" | "mainnet";
}

export interface Store {
	readonly storage: StorageBackend;
	readonly manifests: ManifestStore;
}

/**
 * Factory to create a composed Store with storage backend + manifest store.
 *
 * ```ts
 * // Local (zero config)
 * const store = createStore({ storage: 'local' })
 *
 * // FOC
 * const store = createStore({ storage: 'foc', privateKey: '0x...' })
 *
 * // Custom backend
 * const store = createStore({ storage: myBackend, manifests: myManifestStore })
 * ```
 */
export function createStore(config: StoreConfig): Store {
	const homeDir = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".";
	const defaultDataDir = `${homeDir}/.wtfoc/data`;
	const defaultManifestDir = `${homeDir}/.wtfoc/projects`;

	let storage: StorageBackend;

	if (typeof config.storage === "object") {
		// Custom backend instance
		storage = config.storage;
	} else if (config.storage === "local") {
		storage = new LocalStorageBackend(config.dataDir ?? defaultDataDir);
	} else if (config.storage === "foc") {
		// FOC backend — import dynamically to avoid pulling synapse-sdk for local-only users
		// For now, throw until FocStorageBackend is implemented
		throw new Error(
			"FocStorageBackend not yet implemented. Use 'local' or provide a custom StorageBackend instance.",
		);
	} else {
		throw new Error(`Unknown storage backend: ${config.storage as string}`);
	}

	const manifests =
		config.manifests ?? new LocalManifestStore(config.manifestDir ?? defaultManifestDir);

	return { storage, manifests };
}

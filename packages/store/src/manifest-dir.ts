import type { Store } from "./factory.js";
import { LocalManifestStore } from "./manifest/local.js";

/**
 * Resolve the filesystem directory where a store's collection manifests +
 * sidecars live (document-catalog, raw-source-index, etc.). For stores backed
 * by `LocalManifestStore`, returns its configured `dir`. For anything else,
 * falls back to `~/.wtfoc/projects` (the default `createStore` location).
 *
 * Both CLI `wtfoc promote` and the web-app `promote-worker` use this to find
 * sidecar files when enumerating collection artifacts.
 */
export function getLocalManifestDir(store: Store): string {
	if (store.manifests instanceof LocalManifestStore) {
		return store.manifests.dir;
	}
	const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
	return `${homeDir}/.wtfoc/projects`;
}

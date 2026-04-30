/**
 * Cache directory namespacing keyed on the run fingerprint. Maintainer-only.
 *
 * The dogfood / autoresearch loop sweeps over retrieval, embedder, and
 * extractor knobs. Each variant must use its own on-disk caches so a
 * change to (say) the embedder model never silently re-uses cached
 * vectors from a different model. We solve that by appending the run
 * fingerprint as a subdirectory before handing it to `CachingEmbedder`.
 *
 * Audit (Phase 0c, 2026-04-28): the only persistent retrieval-affecting
 * cache today is `CachingEmbedder.cacheDir`. Other persistent files in
 * `~/.wtfoc/` (manifests, overlay edges, document catalog, raw source
 * archive, cursor store, extraction status) are all corpus-ingest state,
 * not retrieval caches — they're upstream of the dogfood loop and the
 * corpus digest in the fingerprint already pins them. If a new disk-
 * backed retrieval cache is added (rerank, trace, persona-classifier,
 * vector-index snapshot), it MUST be namespaced via this same scheme
 * and the audit list above MUST be updated.
 */

import { join, resolve } from "node:path";

/**
 * Return a cache directory rooted at `baseDir` and namespaced by the
 * fingerprint. Empty/whitespace fingerprints are rejected — that would
 * silently collapse all variants into a single cache and defeat the
 * isolation guarantee.
 */
export function namespacedCacheDir(baseDir: string, fingerprint: string): string {
	const fp = fingerprint.trim();
	if (fp.length === 0) {
		throw new Error("namespacedCacheDir: fingerprint must be non-empty");
	}
	return resolve(join(baseDir, fp));
}

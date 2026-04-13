import { createHash } from "node:crypto";
import type { Chunk, StorageBackend } from "@wtfoc/common";
import type { RawSourceEntry } from "./raw-source-archive.js";

/**
 * Replay raw source content from donor archive entries as Chunks.
 * Each entry is downloaded from storage and yielded as a single chunk
 * (chunkIndex=0, totalChunks=1) with rawContent attached for re-archiving.
 *
 * Failed downloads are logged and skipped — they never abort the replay.
 */
export async function* replayFromArchive(
	entries: RawSourceEntry[],
	storage: StorageBackend,
): AsyncIterable<Chunk> {
	for (const entry of entries) {
		try {
			const bytes = await storage.download(entry.storageId);
			const content = new TextDecoder().decode(bytes);
			const contentFingerprint = createHash("sha256").update(content).digest("hex");

			const chunk: Chunk = {
				id: createHash("sha256").update(`${entry.documentVersionId}:0:${content}`).digest("hex"),
				content,
				sourceType: entry.sourceType,
				source: entry.documentId,
				sourceUrl: entry.sourceUrl,
				chunkIndex: 0,
				totalChunks: 1,
				metadata: {},
				documentId: entry.documentId,
				documentVersionId: entry.documentVersionId,
				contentFingerprint,
				rawContent: content,
			};

			yield chunk;
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(
				`[wtfoc] Warning: failed to download donor blob ${entry.storageId} for ${entry.documentId}: ${message}`,
			);
		}
	}
}

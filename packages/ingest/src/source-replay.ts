import { createHash } from "node:crypto";
import type { Chunk, StorageBackend, TimestampKind } from "@wtfoc/common";
import type { RawSourceEntry } from "./raw-source-archive.js";

function sha256Hex(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Canonical default timestamp kind per source type. Used by the donor-replay
 * path (and any other path that reconstructs a Chunk from an archived raw
 * source entry without running the source's adapter). Kept in one place so
 * the replay default matches what the adapter would have set if it had run.
 *
 * Extend this when adding a new source adapter. Missing entries fall back
 * to `ingested` with `entry.fetchedAt` — an honest low-trust default rather
 * than dropping the field entirely (which poisons chainTemporalCoherence
 * metrics, see gh-282).
 */
export const DEFAULT_TIMESTAMP_KIND_BY_SOURCE_TYPE: Record<string, TimestampKind> = {
	"github-issue": "updated",
	"github-pr": "updated",
	"github-pr-comment": "updated",
	"github-discussion": "updated",
	"slack-message": "created",
	"discord-message": "created",
	code: "committed",
	markdown: "committed",
	"doc-page": "published",
};

/**
 * Derive `{timestamp, timestampKind}` for a replayed chunk. Prefers the
 * adapter's native field from `entry.metadata` (when the donor captured
 * schema-aware metadata), otherwise falls back to `entry.fetchedAt` with
 * kind `ingested`. Never returns an undefined kind — a known low-trust
 * value is strictly better than silent drop for downstream temporal
 * reasoning (gh-282).
 */
export function deriveReplayTimestamp(entry: RawSourceEntry): {
	timestamp: string;
	timestampKind: TimestampKind;
} {
	const defaultKind = DEFAULT_TIMESTAMP_KIND_BY_SOURCE_TYPE[entry.sourceType];
	const metaValue = defaultKind ? entry.metadata?.[defaultKind] : undefined;
	if (defaultKind && metaValue) {
		return { timestamp: metaValue, timestampKind: defaultKind };
	}
	return { timestamp: entry.fetchedAt, timestampKind: "ingested" };
}

/**
 * Replay raw source content from donor archive entries as Chunks.
 * Each entry is downloaded from storage and yielded as a single chunk
 * (chunkIndex=0, totalChunks=1) with rawContent attached for re-archiving.
 *
 * Failed downloads are logged and skipped — they never abort the replay.
 */
/**
 * A raw source document pulled from the archive, paired with its metadata
 * entry and decoded content. The caller owns how to turn this into a
 * ChunkerDocument and route through `selectChunker()`.
 */
export interface RawSourceDocument {
	entry: RawSourceEntry;
	content: string;
}

/**
 * Replay raw source documents from archive entries, yielding
 * { entry, content } pairs. Unlike `replayFromArchive`, this does NOT
 * synthesize a Chunk — the caller is responsible for constructing a
 * ChunkerDocument (with full metadata from `entry.metadata`) and routing
 * through the chunker registry. This is the primitive used by reingest
 * --replay-raw to feed fresh chunkers on existing raw source data.
 *
 * Failed downloads are logged and skipped — they never abort the stream.
 */
export async function* replayRawDocuments(
	entries: RawSourceEntry[],
	storage: StorageBackend,
): AsyncIterable<RawSourceDocument> {
	for (const entry of entries) {
		try {
			const bytes = await storage.download(entry.storageId);
			const content = new TextDecoder().decode(bytes);
			yield { entry, content };
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(
				`[wtfoc] Warning: failed to download raw source blob ${entry.storageId} for ${entry.documentId}: ${message}`,
			);
		}
	}
}

export async function* replayFromArchive(
	entries: RawSourceEntry[],
	storage: StorageBackend,
): AsyncIterable<Chunk> {
	for (const entry of entries) {
		try {
			const bytes = await storage.download(entry.storageId);
			const content = new TextDecoder().decode(bytes);
			const contentFingerprint = sha256Hex(content);

			// Use the same chunk ID scheme as the standard chunker:
			// sha256(documentId:documentVersionId:chunkIndex:content)
			const id = sha256Hex(`${entry.documentId}:${entry.documentVersionId}:0:${content}`);

			// Derive filePath from documentId for mediaType inference
			// (documentId for repo sources is typically "owner/repo/path/to/file.ts")
			const filePath = entry.documentId.includes("/")
				? entry.documentId.split("/").slice(2).join("/") || undefined
				: undefined;

			const { timestamp, timestampKind } = deriveReplayTimestamp(entry);
			const chunk: Chunk = {
				id,
				content,
				sourceType: entry.sourceType,
				source: entry.documentId,
				sourceUrl: entry.sourceUrl,
				timestamp,
				timestampKind,
				chunkIndex: 0,
				totalChunks: 1,
				metadata: filePath ? { filePath } : {},
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

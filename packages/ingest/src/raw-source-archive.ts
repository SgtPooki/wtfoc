import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * A single raw source document entry in the archive index.
 */
export interface RawSourceEntry {
	/** Stable logical key matching Chunk.documentId */
	documentId: string;
	/** Version token matching Chunk.documentVersionId */
	documentVersionId: string;
	/** Media type of the raw content (e.g. "text/typescript", "text/markdown") */
	mediaType: string;
	/** SHA-256 checksum of the raw content */
	checksum: string;
	/** Byte length of the raw content */
	byteLength: number;
	/** When this source was fetched/read */
	fetchedAt: string;
	/** Storage ID where the raw content blob is stored */
	storageId: string;
	/** Source type that produced this document */
	sourceType: string;
	/** Original source URL if available */
	sourceUrl?: string;
}

/**
 * Index of all raw source documents for a collection.
 * Stored as a sidecar JSON file alongside the manifest.
 */
export interface RawSourceIndex {
	schemaVersion: 1;
	collectionId: string;
	/** Map of "documentId@documentVersionId" → entry */
	entries: Record<string, RawSourceEntry>;
}

/**
 * Get the archive index file path for a collection.
 */
export function archiveIndexPath(manifestDir: string, collectionName: string): string {
	return join(manifestDir, `${collectionName}.raw-source-index.json`);
}

/**
 * Read the raw source index from disk.
 */
export async function readArchiveIndex(indexPath: string): Promise<RawSourceIndex | null> {
	try {
		const data = await readFile(indexPath, "utf-8");
		const parsed = JSON.parse(data) as RawSourceIndex;
		if (
			parsed.schemaVersion !== 1 ||
			!parsed.entries ||
			typeof parsed.entries !== "object" ||
			Array.isArray(parsed.entries)
		) {
			return null;
		}
		return parsed;
	} catch (err: unknown) {
		if (
			err &&
			typeof err === "object" &&
			"code" in err &&
			(err as { code?: string }).code === "ENOENT"
		) {
			return null;
		}
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[wtfoc] Warning: failed to read raw source index at ${indexPath}: ${message}`);
		return null;
	}
}

/**
 * Write the raw source index atomically.
 */
export async function writeArchiveIndex(indexPath: string, index: RawSourceIndex): Promise<void> {
	await mkdir(dirname(indexPath), { recursive: true });
	const tmpPath = `${indexPath}.tmp.${Date.now()}`;
	await writeFile(tmpPath, JSON.stringify(index, null, 2));
	await rename(tmpPath, indexPath);
}

/**
 * Create an empty raw source index.
 */
export function createEmptyArchiveIndex(collectionId: string): RawSourceIndex {
	return {
		schemaVersion: 1,
		collectionId,
		entries: {},
	};
}

/**
 * Build the archive key for a document version.
 */
export function archiveKey(documentId: string, documentVersionId: string): string {
	return `${documentId}@${documentVersionId}`;
}

/**
 * Check if a specific document version is already archived.
 */
export function isArchived(
	index: RawSourceIndex,
	documentId: string,
	documentVersionId: string,
): boolean {
	return archiveKey(documentId, documentVersionId) in index.entries;
}

/**
 * Infer media type from file extension or source type.
 */
export function inferMediaType(filePath?: string, sourceType?: string): string {
	if (filePath) {
		const ext = filePath.split(".").pop()?.toLowerCase();
		const mediaTypes: Record<string, string> = {
			ts: "text/typescript",
			tsx: "text/typescript",
			js: "text/javascript",
			jsx: "text/javascript",
			md: "text/markdown",
			mdx: "text/markdown",
			json: "application/json",
			yaml: "text/yaml",
			yml: "text/yaml",
			toml: "text/toml",
			py: "text/x-python",
			go: "text/x-go",
			rs: "text/x-rust",
			rb: "text/x-ruby",
			java: "text/x-java",
			html: "text/html",
			css: "text/css",
		};
		if (ext && ext in mediaTypes) return mediaTypes[ext] as string;
	}
	if (sourceType) {
		if (
			sourceType.startsWith("github-") ||
			sourceType === "hn-story" ||
			sourceType === "hn-comment"
		) {
			return "text/markdown";
		}
		if (sourceType.includes("message")) return "text/plain";
		if (sourceType === "doc-page") return "text/markdown";
	}
	return "text/plain";
}

/**
 * Archive a raw source document. Stores the content blob via the provided
 * upload function and adds an entry to the index.
 *
 * Returns the storage ID, or null if already archived.
 */
export async function archiveRawSource(
	index: RawSourceIndex,
	documentId: string,
	documentVersionId: string,
	content: string,
	options: {
		sourceType: string;
		sourceUrl?: string;
		filePath?: string;
		upload: (data: Uint8Array) => Promise<string>;
	},
): Promise<string | null> {
	const key = archiveKey(documentId, documentVersionId);
	if (key in index.entries) return null;

	const bytes = new TextEncoder().encode(content);
	const checksum = createHash("sha256").update(bytes).digest("hex");
	const storageId = await options.upload(bytes);

	index.entries[key] = {
		documentId,
		documentVersionId,
		mediaType: inferMediaType(options.filePath, options.sourceType),
		checksum,
		byteLength: bytes.length,
		fetchedAt: new Date().toISOString(),
		storageId,
		sourceType: options.sourceType,
		sourceUrl: options.sourceUrl,
	};

	return storageId;
}

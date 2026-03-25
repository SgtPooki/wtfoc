import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface SourceCursor {
	sourceKey: string;
	adapterType: string;
	cursorValue: string;
	lastRunAt: string;
	chunksIngested: number;
}

export interface CursorData {
	schemaVersion: 1;
	cursors: Record<string, SourceCursor>;
}

/**
 * Read cursor data from disk. Returns null if file doesn't exist or is corrupt.
 */
export async function readCursors(cursorPath: string): Promise<CursorData | null> {
	try {
		const data = await readFile(cursorPath, "utf-8");
		const parsed = JSON.parse(data) as CursorData;
		if (parsed.schemaVersion !== 1 || typeof parsed.cursors !== "object") {
			return null;
		}
		return parsed;
	} catch (err) {
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		// Corrupt file — treat as absent (graceful fallback per edge case C4)
		return null;
	}
}

/**
 * Write cursor data atomically (temp + rename). Creates parent directories if needed.
 */
export async function writeCursors(cursorPath: string, data: CursorData): Promise<void> {
	await mkdir(dirname(cursorPath), { recursive: true });
	const tmpPath = `${cursorPath}.tmp.${Date.now()}`;
	await writeFile(tmpPath, JSON.stringify(data, null, 2));
	await rename(tmpPath, cursorPath);
}

/**
 * Get the cursor file path for a collection.
 */
export function cursorFilePath(manifestDir: string, collectionName: string): string {
	return join(manifestDir, `${collectionName}.ingest-cursors.json`);
}

/**
 * Extract the cursorValue for a given source key, or undefined if no cursor exists.
 */
export function getCursorSince(data: CursorData | null, sourceKey: string): string | undefined {
	if (!data) return undefined;
	const cursor = data.cursors[sourceKey];
	return cursor?.cursorValue;
}

/**
 * Build a source key from adapter type and source argument.
 * Format: "{adapterType}:{sourceArg}"
 */
export function buildSourceKey(adapterType: string, sourceArg: string): string {
	return `${adapterType}:${sourceArg}`;
}

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ContextStatus {
	contextId: string;
	contextHash: string;
	chunkIds: string[];
	status: "pending" | "completed" | "failed";
	edgeCount?: number;
	error?: string;
	timestamp?: string;
}

export interface ExtractionStatusData {
	extractorModel: string;
	contexts: Record<string, ContextStatus>;
}

/**
 * Read extraction status from disk. Returns null if file doesn't exist.
 */
export async function readExtractionStatus(
	statusPath: string,
): Promise<ExtractionStatusData | null> {
	try {
		const data = await readFile(statusPath, "utf-8");
		return JSON.parse(data) as ExtractionStatusData;
	} catch {
		return null;
	}
}

/**
 * Write extraction status to disk atomically (temp + rename).
 */
export async function writeExtractionStatus(
	statusPath: string,
	data: ExtractionStatusData,
): Promise<void> {
	const tmpPath = `${statusPath}.tmp.${Date.now()}`;
	await writeFile(tmpPath, JSON.stringify(data, null, 2));
	await rename(tmpPath, statusPath);
}

/**
 * Get the extraction status file path for a collection.
 */
export function statusFilePath(projectDir: string, collectionName: string): string {
	return join(projectDir, collectionName, ".extraction-status.json");
}

/**
 * Compute a context hash from chunk contents.
 */
export async function computeContextHash(
	chunks: Array<{ id: string; content: string }>,
): Promise<string> {
	const { createHash } = await import("node:crypto");
	const hash = createHash("sha256");
	for (const chunk of chunks.sort((a, b) => a.id.localeCompare(b.id))) {
		hash.update(chunk.id);
		hash.update(chunk.content);
	}
	return hash.digest("hex");
}

/**
 * Determine which contexts need extraction based on status.
 * Returns contexts that are pending, failed, or have changed content.
 */
export function getContextsToProcess(
	status: ExtractionStatusData | null,
	contexts: Array<{ contextId: string; contextHash: string; chunkIds: string[] }>,
	model: string,
): Array<{ contextId: string; contextHash: string; chunkIds: string[] }> {
	// If no status file or model changed, process everything
	if (!status || status.extractorModel !== model) {
		return contexts;
	}

	return contexts.filter((ctx) => {
		const existing = status.contexts[ctx.contextId];
		if (!existing) return true; // new context
		if (existing.status === "failed") return true; // retry failed
		if (existing.status === "pending") return true; // not yet processed
		if (existing.contextHash !== ctx.contextHash) return true; // content changed
		return false; // completed and unchanged
	});
}

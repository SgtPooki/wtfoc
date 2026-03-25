import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Edge } from "@wtfoc/common";
import { edgeKey } from "./merge.js";

export interface OverlayEdgeData {
	collectionId: string;
	edges: Edge[];
	createdAt: string;
	updatedAt: string;
}

/**
 * Get the overlay edge file path for a collection.
 */
export function overlayFilePath(projectDir: string, collectionName: string): string {
	return join(projectDir, collectionName, "edges-overlay.json");
}

/**
 * Read overlay edges from disk. Returns null if file doesn't exist.
 */
export async function readOverlayEdges(filePath: string): Promise<OverlayEdgeData | null> {
	try {
		const data = await readFile(filePath, "utf-8");
		return JSON.parse(data) as OverlayEdgeData;
	} catch {
		return null;
	}
}

/**
 * Write overlay edges to disk atomically (temp + rename).
 */
export async function writeOverlayEdges(filePath: string, data: OverlayEdgeData): Promise<void> {
	const tmpPath = `${filePath}.tmp.${Date.now()}`;
	await writeFile(tmpPath, JSON.stringify(data, null, 2));
	await rename(tmpPath, filePath);
}

/**
 * Merge new edges into existing overlay, deduplicating by canonical key.
 * New edges with the same key replace existing ones.
 */
export function mergeOverlayEdges(existing: Edge[], newEdges: Edge[]): Edge[] {
	const edgeMap = new Map<string, Edge>();

	for (const edge of existing) {
		edgeMap.set(edgeKey(edge), edge);
	}
	for (const edge of newEdges) {
		edgeMap.set(edgeKey(edge), edge);
	}

	return [...edgeMap.values()];
}

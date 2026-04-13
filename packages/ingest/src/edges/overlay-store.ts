import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Edge } from "@wtfoc/common";
import { edgeKey } from "./merge.js";

export interface OverlayEdgeData {
	collectionId: string;
	edges: Edge[];
	createdAt: string;
	updatedAt: string;
}

/**
 * Get the per-extractor overlay edges file path for a collection.
 * Layout: {manifestDir}/{collection}.edge-overlays/{extractorId}/edges.json
 */
export function overlayFilePath(
	manifestDir: string,
	collectionName: string,
	extractorId: string,
): string {
	return join(manifestDir, `${collectionName}.edge-overlays`, extractorId, "edges.json");
}

/**
 * Get the per-extractor status file path for a collection.
 * Layout: {manifestDir}/{collection}.edge-overlays/{extractorId}/status.json
 */
export function statusFilePath(
	manifestDir: string,
	collectionName: string,
	extractorId: string,
): string {
	return join(manifestDir, `${collectionName}.edge-overlays`, extractorId, "status.json");
}

/**
 * Get the root directory for all extractor overlays for a collection.
 */
export function overlayRootDir(manifestDir: string, collectionName: string): string {
	return join(manifestDir, `${collectionName}.edge-overlays`);
}

/**
 * List all extractor IDs that have overlay data for a collection.
 * Returns empty array if the overlay root doesn't exist.
 */
export async function listExtractorOverlayIds(
	manifestDir: string,
	collectionName: string,
): Promise<string[]> {
	const root = overlayRootDir(manifestDir, collectionName);
	try {
		const entries = await readdir(root, { withFileTypes: true });
		return entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}
}

/**
 * Read overlay edges from disk. Returns null if file doesn't exist.
 */
export async function readOverlayEdges(filePath: string): Promise<OverlayEdgeData | null> {
	try {
		const data = await readFile(filePath, "utf-8");
		return JSON.parse(data) as OverlayEdgeData;
	} catch (err) {
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		console.error(`[wtfoc] Warning: failed to read overlay edges at ${filePath}:`, err);
		return null;
	}
}

/**
 * Write overlay edges to disk atomically (temp + rename).
 */
export async function writeOverlayEdges(filePath: string, data: OverlayEdgeData): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	const tmpPath = `${filePath}.tmp.${Date.now()}`;
	await writeFile(tmpPath, JSON.stringify(data, null, 2));
	await rename(tmpPath, filePath);
}

/**
 * Load and merge all extractor overlay edges for a collection.
 * Useful for commands that need the combined view of all overlay sources.
 */
export async function loadAllOverlayEdges(
	manifestDir: string,
	collectionName: string,
): Promise<Edge[]> {
	const extractorIds = await listExtractorOverlayIds(manifestDir, collectionName);
	let merged: Edge[] = [];
	for (const extractorId of extractorIds) {
		const filePath = overlayFilePath(manifestDir, collectionName, extractorId);
		const overlay = await readOverlayEdges(filePath);
		if (overlay?.edges.length) {
			merged = mergeOverlayEdges(merged, overlay.edges);
		}
	}
	return merged;
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

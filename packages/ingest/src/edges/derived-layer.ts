import { createHash } from "node:crypto";
import type { Edge } from "@wtfoc/common";

/**
 * Immutable derived-edge layer blob.
 * Each extract-edges run produces one of these.
 * Stored as JSON alongside segments, referenced by CollectionHead.derivedEdgeLayers.
 */
export interface DerivedEdgeLayer {
	schemaVersion: 1;
	collectionId: string;
	/** Extractor model that produced these edges */
	extractorModel: string;
	/** When this layer was created */
	createdAt: string;
	/** Contexts processed in this extraction run */
	contextsProcessed: number;
	/** The edges in this layer */
	edges: Edge[];
}

/**
 * Compute a deterministic ID for a derived edge layer (SHA-256 of serialized JSON).
 */
export function derivedLayerId(layer: DerivedEdgeLayer): string {
	const serialized = JSON.stringify(layer);
	return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Build a DerivedEdgeLayer from extraction results.
 */
export function buildDerivedEdgeLayer(
	collectionId: string,
	extractorModel: string,
	edges: Edge[],
	contextsProcessed: number,
): DerivedEdgeLayer {
	return {
		schemaVersion: 1,
		collectionId,
		extractorModel,
		createdAt: new Date().toISOString(),
		contextsProcessed,
		edges,
	};
}

/**
 * Parse a downloaded derived edge layer blob.
 */
export function parseDerivedEdgeLayer(data: Uint8Array): DerivedEdgeLayer {
	const text = new TextDecoder().decode(data);
	return JSON.parse(text) as DerivedEdgeLayer;
}

/**
 * Load all derived edge layers from storage and merge into a flat edge array.
 */
export async function loadDerivedEdgeLayers(
	layerRefs: Array<{ id: string }>,
	download: (id: string, signal?: AbortSignal) => Promise<Uint8Array>,
	signal?: AbortSignal,
): Promise<Edge[]> {
	const allEdges: Edge[] = [];
	for (const ref of layerRefs) {
		signal?.throwIfAborted();
		const data = await download(ref.id, signal);
		const layer = parseDerivedEdgeLayer(data);
		allEdges.push(...layer.edges);
	}
	return allEdges;
}

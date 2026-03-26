import { extname } from "node:path";
import type { Chunk, Edge, EdgeExtractor } from "@wtfoc/common";
import { type TreeSitterClientOptions, treeSitterParse } from "./tree-sitter-client.js";

/** File extension → tree-sitter language name */
const EXT_TO_LANGUAGE: Record<string, string> = {
	".ts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
	".go": "go",
	".rs": "rust",
	".rb": "ruby",
	".java": "java",
	".c": "c",
	".h": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".hpp": "cpp",
};

export interface TreeSitterEdgeExtractorOptions {
	baseUrl: string;
	timeoutMs?: number;
	/** Max chunks to send in parallel. Default: 8 */
	maxConcurrency?: number;
}

/**
 * Edge extractor that delegates code parsing to a tree-sitter HTTP sidecar.
 *
 * Fail-open: if the sidecar is unavailable, returns an empty array
 * (other extractors like CodeEdgeExtractor still run via the composite).
 */
export class TreeSitterEdgeExtractor implements EdgeExtractor {
	readonly #options: TreeSitterClientOptions;
	readonly #maxConcurrency: number;

	constructor(options: TreeSitterEdgeExtractorOptions) {
		this.#options = { baseUrl: options.baseUrl, timeoutMs: options.timeoutMs ?? 5000 };
		this.#maxConcurrency = options.maxConcurrency ?? 8;
	}

	async extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]> {
		signal?.throwIfAborted();

		// Filter to code chunks with supported extensions
		const codeChunks = chunks.filter((chunk) => {
			if (chunk.sourceType !== "code" && chunk.sourceType !== "repo") return false;
			const ext = extname(chunk.source || "");
			return ext in EXT_TO_LANGUAGE;
		});

		if (codeChunks.length === 0) return [];

		// Process with bounded concurrency
		const edges: Edge[] = [];
		for (let i = 0; i < codeChunks.length; i += this.#maxConcurrency) {
			signal?.throwIfAborted();
			const batch = codeChunks.slice(i, i + this.#maxConcurrency);

			const results = await Promise.all(
				batch.map(async (chunk) => {
					const ext = extname(chunk.source || "");
					const language = EXT_TO_LANGUAGE[ext];
					if (!language) return [];

					const response = await treeSitterParse(
						{ language, content: chunk.content, path: chunk.source },
						this.#options,
						signal,
					);

					if (!response) return [];

					return response.edges.map(
						(e): Edge => ({
							type: e.type,
							sourceId: chunk.id,
							targetType: e.targetType,
							targetId: e.targetId,
							evidence: e.evidence,
							confidence: e.confidence,
						}),
					);
				}),
			);

			for (const resultEdges of results) edges.push(...resultEdges);
		}

		return edges;
	}
}

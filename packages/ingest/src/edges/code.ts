import { basename, extname } from "node:path";
import type { Chunk, Edge, EdgeExtractor } from "@wtfoc/common";
import { extractPackageJsonDeps, extractRequirementsTxtDeps } from "./dependency-parser.js";
import { extractJsImportsWithOxc } from "./oxc-parser.js";

// Go: import "fmt" / import ( "fmt" \n "os" )
const GO_IMPORT_PATTERN = /\bimport\s+(?:"([^"]+)"|\(\s*([\s\S]*?)\s*\))/g;
const GO_IMPORT_LINE = /"([^"]+)"/g;
// Solidity: import "file.sol" / import { X } from "file.sol"
const SOL_IMPORT_PATTERN = /\bimport\s+(?:\{[^}]*\}\s+from\s+)?['"]([^'"]+)['"]/g;
// Rust: use crate::module / use std::collections::HashMap
const RUST_USE_PATTERN = /\buse\s+([a-zA-Z_][a-zA-Z0-9_]*(?:::[a-zA-Z_][a-zA-Z0-9_]*)*)/g;
// Python: import module / from module import ...
const PYTHON_IMPORT_PATTERN = /^(?:import|from)\s+([a-zA-Z0-9_.]+)/gm;

// Regex fallback for JS/TS (used when oxc-parser unavailable)
const ES_IMPORT_PATTERN = /\bimport\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const ES_REEXPORT_PATTERN = /\bexport\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_PATTERN = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const SUPPORTED_EXTENSIONS: Record<string, string> = {
	".ts": "js",
	".tsx": "js",
	".js": "js",
	".jsx": "js",
	".mjs": "js",
	".cjs": "js",
	".py": "python",
	".go": "go",
	".sol": "solidity",
	".rs": "rust",
};

/**
 * Code-aware edge extractor for imports and dependencies.
 *
 * Strategy:
 * - JS/TS: oxc-parser (AST-based, confidence 1.0) with regex fallback (0.95)
 * - Python/Go/Solidity/Rust: regex-based (0.95)
 * - package.json: JSON parser (1.0)
 * - requirements.txt: line parser (1.0)
 * - go.mod: line parser (1.0)
 *
 * Tree-sitter sidecar for full AST parsing tracked in #134.
 */
/**
 * Reconstruct a manifest file from one or more chunks.
 * Sorts by chunkIndex, strips overlap between adjacent chunks, and
 * concatenates content. Uses the first chunk's identity for edge sourceId.
 *
 * The repo chunker uses a fixed overlap (default 50 chars) between adjacent
 * chunks. Naive concatenation would duplicate the overlap bytes and produce
 * invalid content (e.g., broken JSON). We detect and strip the overlap by
 * finding the longest suffix/prefix match between consecutive chunks.
 */
function reconstructManifest(chunks: Chunk[]): Chunk {
	if (chunks.length === 1) {
		const [single] = chunks;
		return single as Chunk;
	}

	const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
	const [first, ...rest] = sorted;
	const parts: string[] = [(first as Chunk).content];

	let prevContent = (first as Chunk).content;
	for (const chunk of rest) {
		const overlap = findOverlap(prevContent, chunk.content);
		parts.push(chunk.content.slice(overlap));
		prevContent = chunk.content;
	}

	return {
		...(first as Chunk),
		content: parts.join(""),
		totalChunks: 1,
	};
}

/**
 * Find the length of the longest suffix of `a` that matches a prefix of `b`.
 * Searches up to 200 chars (well above the default 50-char overlap).
 */
function findOverlap(a: string, b: string): number {
	const maxCheck = Math.min(a.length, b.length, 200);
	for (let len = maxCheck; len > 0; len--) {
		if (a.endsWith(b.slice(0, len))) return len;
	}
	return 0;
}

const MANIFEST_PARSERS: Record<string, (chunk: Chunk) => Edge[]> = {
	"package.json": extractPackageJsonDeps,
	"requirements.txt": extractRequirementsTxtDeps,
};

export class CodeEdgeExtractor implements EdgeExtractor {
	async extract(chunks: Chunk[], signal?: AbortSignal): Promise<Edge[]> {
		signal?.throwIfAborted();

		// Group manifest chunks by source so we can reconstruct split files
		const manifestGroups = new Map<string, Chunk[]>();
		const nonManifestChunks: Chunk[] = [];

		for (const chunk of chunks) {
			signal?.throwIfAborted();
			if (chunk.sourceType !== "code" && chunk.sourceType !== "repo") continue;
			const source = chunk.source || "";
			const filename = basename(source);

			if (filename === "package.json" || filename === "requirements.txt" || filename === "go.mod") {
				const group = manifestGroups.get(source);
				if (group) {
					group.push(chunk);
				} else {
					manifestGroups.set(source, [chunk]);
				}
			} else {
				nonManifestChunks.push(chunk);
			}
		}

		const edges: Edge[] = [];

		// Process manifest groups — reconstruct from multi-chunk if needed
		for (const [source, group] of manifestGroups) {
			signal?.throwIfAborted();
			const filename = basename(source);
			const reconstructed = reconstructManifest(group);

			if (filename === "go.mod") {
				edges.push(...this.#extractGoModDeps(reconstructed));
			} else {
				const parser = MANIFEST_PARSERS[filename];
				if (parser) {
					edges.push(...parser(reconstructed));
				}
			}
		}

		// Process non-manifest code chunks as before
		for (const chunk of nonManifestChunks) {
			signal?.throwIfAborted();
			const source = chunk.source || "";
			const ext = extname(source);

			const lang = SUPPORTED_EXTENSIONS[ext];
			if (!lang) continue;

			if (lang === "js") {
				// oxc-parser for static imports (confidence 1.0) + regex for require/dynamic (0.95)
				const oxcEdges = await extractJsImportsWithOxc(chunk);
				const regexEdges = this.#extractJsImportsRegex(chunk);
				if (oxcEdges) {
					// Merge: oxc edges take priority, regex fills gaps (require, dynamic import)
					const oxcTargets = new Set(oxcEdges.map((e) => e.targetId));
					edges.push(...oxcEdges);
					edges.push(...regexEdges.filter((e) => !oxcTargets.has(e.targetId)));
				} else {
					edges.push(...regexEdges);
				}
			} else if (lang === "python") {
				edges.push(...this.#extractWithPattern(chunk, PYTHON_IMPORT_PATTERN));
			} else if (lang === "go") {
				edges.push(...this.#extractGoImports(chunk));
			} else if (lang === "solidity") {
				edges.push(...this.#extractWithPattern(chunk, SOL_IMPORT_PATTERN));
			} else if (lang === "rust") {
				edges.push(...this.#extractWithPattern(chunk, RUST_USE_PATTERN));
			}
		}
		return edges;
	}

	#extractJsImportsRegex(chunk: Chunk): Edge[] {
		const edges: Edge[] = [];
		const seen = new Set<string>();

		for (const pattern of [
			ES_IMPORT_PATTERN,
			ES_REEXPORT_PATTERN,
			DYNAMIC_IMPORT_PATTERN,
			REQUIRE_PATTERN,
		]) {
			pattern.lastIndex = 0;
			for (const match of chunk.content.matchAll(pattern)) {
				const modulePath = match[1];
				if (!modulePath || seen.has(modulePath)) continue;
				seen.add(modulePath);
				edges.push({
					type: "imports",
					sourceId: chunk.id,
					targetType: "module",
					targetId: modulePath,
					evidence: match[0].trim().split("\n")[0] ?? match[0].trim(),
					confidence: 0.95,
				});
			}
		}
		return edges;
	}

	#extractGoImports(chunk: Chunk): Edge[] {
		const edges: Edge[] = [];
		const seen = new Set<string>();

		GO_IMPORT_PATTERN.lastIndex = 0;
		for (const match of chunk.content.matchAll(GO_IMPORT_PATTERN)) {
			if (match[1] && !seen.has(match[1])) {
				seen.add(match[1]);
				edges.push(this.#importEdge(chunk.id, match[1], `import "${match[1]}"`));
			}
			if (match[2]) {
				GO_IMPORT_LINE.lastIndex = 0;
				for (const lineMatch of match[2].matchAll(GO_IMPORT_LINE)) {
					const pkg = lineMatch[1];
					if (pkg && !seen.has(pkg)) {
						seen.add(pkg);
						edges.push(this.#importEdge(chunk.id, pkg, `import "${pkg}"`));
					}
				}
			}
		}
		return edges;
	}

	#extractWithPattern(chunk: Chunk, pattern: RegExp): Edge[] {
		const edges: Edge[] = [];
		const seen = new Set<string>();

		pattern.lastIndex = 0;
		for (const match of chunk.content.matchAll(pattern)) {
			const modulePath = match[1];
			if (!modulePath || seen.has(modulePath)) continue;
			seen.add(modulePath);
			edges.push(this.#importEdge(chunk.id, modulePath, match[0].trim()));
		}
		return edges;
	}

	#extractGoModDeps(chunk: Chunk): Edge[] {
		const edges: Edge[] = [];
		const seen = new Set<string>();

		for (const line of chunk.content.split("\n")) {
			const trimmed = line.trim();
			const match = /^(?:require\s+)?([a-zA-Z0-9._/-]+)\s+v/.exec(trimmed);
			if (!match?.[0]) continue;
			const pkg = match[1];
			if (!pkg || seen.has(pkg)) continue;
			seen.add(pkg);
			edges.push({
				type: "depends-on",
				sourceId: chunk.id,
				targetType: "package",
				targetId: pkg,
				evidence: trimmed,
				confidence: 1.0,
			});
		}
		return edges;
	}

	#importEdge(sourceId: string, targetId: string, evidence: string): Edge {
		return {
			type: "imports",
			sourceId,
			targetType: "module",
			targetId,
			evidence,
			confidence: 0.95,
		};
	}
}

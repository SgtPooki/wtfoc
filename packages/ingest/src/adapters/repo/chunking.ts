import { readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { Chunk } from "@wtfoc/common";
import { sha256Hex } from "../../chunker.js";

/**
 * Manifest files that should always be emitted as a single chunk.
 * These are dependency/config files whose content must be parsed as a whole
 * (e.g., JSON.parse on package.json fails on fragments).
 */
export const MANIFEST_FILENAMES = new Set([
	"package.json",
	"package-lock.json",
	"go.mod",
	"go.sum",
	"requirements.txt",
	"Pipfile",
	"Cargo.toml",
	"Cargo.lock",
	"pom.xml",
	"build.gradle",
	"Gemfile",
	"composer.json",
	"pyproject.toml",
	"tsconfig.json",
	"deno.json",
	"jsr.json",
]);

export const DEFAULT_INCLUDE = new Set([
	".ts",
	".js",
	".tsx",
	".jsx",
	".md",
	".mdx",
	".json",
	".yaml",
	".yml",
	".toml",
]);

export const DEFAULT_EXCLUDE = [
	"node_modules",
	"dist",
	".git",
	".next",
	"__pycache__",
	"coverage",
	".turbo",
];

export async function walkFiles(
	dir: string,
	includeExts: Set<string>,
	excludeDirs: string[],
	ignoreFilter?: (path: string) => boolean,
): Promise<string[]> {
	const files: string[] = [];

	async function walk(currentDir: string): Promise<void> {
		const entries = await readdir(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(currentDir, entry.name);
			const relativePath = relative(dir, fullPath).replace(/\\/g, "/");
			if (entry.isDirectory()) {
				if (excludeDirs.includes(entry.name) || entry.name.startsWith(".")) {
					continue;
				}
				if (ignoreFilter && !ignoreFilter(relativePath)) {
					continue;
				}
				await walk(fullPath);
			} else if (entry.isFile()) {
				if (!includeExts.has(extname(entry.name))) {
					continue;
				}
				if (ignoreFilter && !ignoreFilter(relativePath)) {
					continue;
				}
				files.push(fullPath);
			}
		}
	}

	await walk(dir);
	return files.sort();
}

export interface ChunkCodeOptions {
	documentId?: string;
	documentVersionId?: string;
}

export function chunkCode(
	content: string,
	filePath: string,
	repo: string,
	sourceUrl: string,
	options?: ChunkCodeOptions,
): Chunk[] {
	const documentId = options?.documentId;
	const documentVersionId = options?.documentVersionId;

	function makeChunkId(chunkContent: string, idx: number): string {
		if (documentId && documentVersionId) {
			return sha256Hex(`${documentId}:${documentVersionId}:${idx}:${chunkContent}`);
		}
		return sha256Hex(chunkContent);
	}

	// Manifest files are emitted as a single chunk so parsers get complete content
	if (MANIFEST_FILENAMES.has(basename(filePath))) {
		if (!content.trim()) return [];
		const contentFingerprint = sha256Hex(content);
		const chunk: Chunk = {
			id: makeChunkId(content, 0),
			content,
			sourceType: "code",
			source: `${repo}/${filePath}`,
			sourceUrl,
			chunkIndex: 0,
			totalChunks: 1,
			metadata: {
				filePath,
				language: extname(filePath).slice(1),
				repo,
			},
			contentFingerprint,
		};
		if (documentId) chunk.documentId = documentId;
		if (documentVersionId) chunk.documentVersionId = documentVersionId;
		return [chunk];
	}

	const chunkSize = 512;
	const overlap = 50;
	const chunks: Chunk[] = [];
	let offset = 0;
	let chunkIndex = 0;

	while (offset < content.length) {
		const end = Math.min(offset + chunkSize, content.length);
		const chunkContent = content.slice(offset, end);

		if (chunkContent.trim()) {
			const contentFingerprint = sha256Hex(chunkContent);
			const chunk: Chunk = {
				id: makeChunkId(chunkContent, chunkIndex),
				content: chunkContent,
				sourceType: "code",
				source: `${repo}/${filePath}`,
				sourceUrl,
				chunkIndex,
				totalChunks: 0,
				metadata: {
					filePath,
					language: extname(filePath).slice(1),
					repo,
				},
				contentFingerprint,
			};
			if (documentId) chunk.documentId = documentId;
			if (documentVersionId) chunk.documentVersionId = documentVersionId;
			chunks.push(chunk);
			chunkIndex++;
		}

		offset = end - overlap;
		if (end === content.length) break;
	}

	for (const chunk of chunks) {
		chunk.totalChunks = chunks.length;
	}

	return chunks;
}

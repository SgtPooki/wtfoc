import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { Chunk } from "@wtfoc/common";

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

export function chunkCode(
	content: string,
	filePath: string,
	repo: string,
	sourceUrl: string,
): Chunk[] {
	// Manifest files are emitted as a single chunk so parsers get complete content
	if (MANIFEST_FILENAMES.has(basename(filePath))) {
		if (!content.trim()) return [];
		const id = createHash("sha256").update(content).digest("hex");
		return [
			{
				id,
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
			},
		];
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
			const id = createHash("sha256").update(chunkContent).digest("hex");

			chunks.push({
				id,
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
			});
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

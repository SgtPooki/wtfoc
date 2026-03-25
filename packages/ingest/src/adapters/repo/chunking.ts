import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Chunk } from "@wtfoc/common";

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
): Promise<string[]> {
	const files: string[] = [];

	async function walk(currentDir: string): Promise<void> {
		const entries = await readdir(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(currentDir, entry.name);
			if (entry.isDirectory()) {
				if (!excludeDirs.includes(entry.name) && !entry.name.startsWith(".")) {
					await walk(fullPath);
				}
			} else if (entry.isFile()) {
				if (includeExts.has(extname(entry.name))) {
					files.push(fullPath);
				}
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

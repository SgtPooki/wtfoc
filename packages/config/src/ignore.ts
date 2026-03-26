import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_IGNORE_PATTERNS } from "@wtfoc/common";
import ignore from "ignore";

function normalizePath(inputPath: string): string {
	let normalized = inputPath.replace(/\\/g, "/");
	if (normalized.startsWith("./")) {
		normalized = normalized.slice(2);
	}
	return normalized;
}

export function createIgnoreFilter(
	...patternSources: (string[] | undefined)[]
): (path: string) => boolean {
	const ig = ignore();
	ig.add([...BUILTIN_IGNORE_PATTERNS]);
	for (const source of patternSources) {
		if (source && source.length > 0) {
			ig.add(source);
		}
	}
	return (path: string): boolean => !ig.ignores(normalizePath(path));
}

export function loadWtfocIgnore(repoRoot: string): string[] {
	const filePath = join(repoRoot, ".wtfocignore");
	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") {
			return [];
		}
		throw err;
	}
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

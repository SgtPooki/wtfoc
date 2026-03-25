import { BUILTIN_IGNORE_PATTERNS } from "@wtfoc/common";
import ignore from "ignore";

function normalizePath(inputPath: string): string {
	let normalized = inputPath.replace(/\\/g, "/");
	if (normalized.startsWith("./")) {
		normalized = normalized.slice(2);
	}
	return normalized;
}

export function createIgnoreFilter(userPatterns?: string[]): (path: string) => boolean {
	const ig = ignore();
	ig.add([...BUILTIN_IGNORE_PATTERNS]);
	if (userPatterns) {
		ig.add(userPatterns);
	}
	return (path: string): boolean => !ig.ignores(normalizePath(path));
}

import { BUILTIN_IGNORE_PATTERNS } from "@wtfoc/common";
import ignore from "ignore";

export function createIgnoreFilter(userPatterns?: string[]): (path: string) => boolean {
	const ig = ignore();
	ig.add([...BUILTIN_IGNORE_PATTERNS]);
	if (userPatterns) {
		ig.add(userPatterns);
	}
	return (path: string): boolean => !ig.ignores(path);
}

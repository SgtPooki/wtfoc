import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "@wtfoc/common";
import { ConfigParseError } from "@wtfoc/common";
import { validateProjectConfig } from "./validator.js";

export function loadProjectConfig(cwd?: string): ProjectConfig | undefined {
	const dir = cwd ?? process.cwd();
	const filePath = join(dir, ".wtfoc.json");

	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") {
			return undefined;
		}
		throw err;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		throw new ConfigParseError(filePath, message);
	}

	return validateProjectConfig(parsed, filePath);
}

import type { Chunk, Edge } from "@wtfoc/common";

// Quick check: does the chunk likely contain import/export statements?
const IMPORT_HINT = /\b(?:import|export|require)\b/;

// Cached: undefined = not tried, null = unavailable
let cachedMod: Awaited<typeof import("oxc-parser")> | null | undefined;

async function loadOxc(): Promise<Awaited<typeof import("oxc-parser")> | null> {
	if (cachedMod !== undefined) return cachedMod;
	try {
		cachedMod = await import("oxc-parser");
		return cachedMod;
	} catch {
		cachedMod = null;
		return null;
	}
}

/**
 * Extract import edges from JS/TS code using oxc-parser (optional dependency).
 * Returns null if oxc-parser is not available or chunk doesn't contain imports.
 * Caches the parser module after first load.
 */
export async function extractJsImportsWithOxc(chunk: Chunk): Promise<Edge[] | null> {
	if (!IMPORT_HINT.test(chunk.content)) return null;

	const oxc = await loadOxc();
	if (!oxc) return null;

	try {
		const ext = chunk.source?.split(".").pop() ?? "ts";
		const result = oxc.parseSync(`file.${ext}`, chunk.content);
		const edges: Edge[] = [];
		const seen = new Set<string>();

		for (const node of result.program.body) {
			let modulePath: string | undefined;
			let evidencePrefix: string;

			if (node.type === "ImportDeclaration" && node.source) {
				modulePath = node.source.value;
				evidencePrefix = "import";
			} else if (
				(node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
				"source" in node &&
				node.source
			) {
				modulePath = node.source.value;
				evidencePrefix = "export";
			} else {
				continue;
			}

			if (modulePath && !seen.has(modulePath)) {
				seen.add(modulePath);
				edges.push({
					type: "imports",
					sourceId: chunk.id,
					targetType: "module",
					targetId: modulePath,
					evidence: `${evidencePrefix} from "${modulePath}"`,
					confidence: 1.0,
				});
			}
		}

		return edges;
	} catch {
		return null;
	}
}

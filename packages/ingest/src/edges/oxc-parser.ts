import type { Chunk, Edge } from "@wtfoc/common";

/**
 * Extract import edges from JS/TS code using oxc-parser.
 * Returns null if oxc-parser is not available (optional dependency).
 *
 * oxc-parser provides direct ESM import/export metadata — faster and
 * more accurate than regex for JS/TS.
 */
export async function extractJsImportsWithOxc(chunk: Chunk): Promise<Edge[] | null> {
	try {
		const { parseSync } = await import("oxc-parser");

		const ext = chunk.source?.split(".").pop() ?? "ts";
		const filename = `file.${ext}`;
		const result = parseSync(filename, chunk.content);

		const edges: Edge[] = [];
		const seen = new Set<string>();

		for (const node of result.program.body) {
			// ImportDeclaration: import ... from "module"
			if (node.type === "ImportDeclaration" && node.source?.value) {
				const modulePath = node.source.value;
				if (!seen.has(modulePath)) {
					seen.add(modulePath);
					edges.push({
						type: "imports",
						sourceId: chunk.id,
						targetType: "module",
						targetId: modulePath,
						evidence: `import from "${modulePath}"`,
						confidence: 1.0,
					});
				}
			}

			// ExportNamedDeclaration / ExportAllDeclaration with source: export ... from "module"
			if (
				(node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") &&
				node.source?.value
			) {
				const modulePath = node.source.value;
				if (!seen.has(modulePath)) {
					seen.add(modulePath);
					edges.push({
						type: "imports",
						sourceId: chunk.id,
						targetType: "module",
						targetId: modulePath,
						evidence: `export from "${modulePath}"`,
						confidence: 1.0,
					});
				}
			}
		}

		return edges;
	} catch {
		// oxc-parser not available or parse failed — return null to fall back to regex
		return null;
	}
}

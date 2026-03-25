import type { Chunk, Edge } from "@wtfoc/common";

/**
 * Parse package.json content and extract dependency edges.
 */
export function extractPackageJsonDeps(chunk: Chunk): Edge[] {
	try {
		const pkg = JSON.parse(chunk.content) as Record<string, unknown>;
		const edges: Edge[] = [];

		for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
			const deps = pkg[field];
			if (typeof deps !== "object" || deps === null) continue;

			for (const name of Object.keys(deps as Record<string, unknown>)) {
				edges.push({
					type: "depends-on",
					sourceId: chunk.id,
					targetType: "package",
					targetId: name,
					evidence: `${field}: ${name}`,
					confidence: 1.0,
				});
			}
		}

		return edges;
	} catch {
		return [];
	}
}

/**
 * Parse requirements.txt content and extract dependency edges.
 * Handles: package==version, package>=version, package, -r includes, comments.
 */
export function extractRequirementsTxtDeps(chunk: Chunk): Edge[] {
	const edges: Edge[] = [];
	const seen = new Set<string>();

	for (const line of chunk.content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
		// Skip URL/VCS requirements (git+https://, http://, etc.)
		if (/^(?:https?:|git\+|svn\+|hg\+|bzr\+)/.test(trimmed)) continue;

		// Extract package name (before any version specifier)
		const match = /^([a-zA-Z0-9._-]+)/.exec(trimmed);
		if (!match?.[0]) continue;

		const name = match[0];
		if (seen.has(name)) continue;
		seen.add(name);

		edges.push({
			type: "depends-on",
			sourceId: chunk.id,
			targetType: "package",
			targetId: name,
			evidence: trimmed,
			confidence: 1.0,
		});
	}

	return edges;
}

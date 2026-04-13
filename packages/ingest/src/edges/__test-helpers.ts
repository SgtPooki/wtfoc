/**
 * Shared test factories for edge extraction tests.
 *
 * This module is test-only — NOT exported from the package public API.
 * Import in test files: `import { makeChunk, makeEdge } from "./__test-helpers.js";`
 */
import type { Chunk, Edge } from "@wtfoc/common";

export function makeChunk(
	contentOrOverrides?: string | Partial<Chunk>,
	overrides?: Partial<Chunk>,
): Chunk {
	const base: Chunk = {
		id: "chunk-1",
		content: "test content",
		sourceType: "github-pr",
		source: "owner/repo#10",
		chunkIndex: 0,
		totalChunks: 1,
		metadata: {},
	};

	if (typeof contentOrOverrides === "string") {
		return { ...base, content: contentOrOverrides, ...overrides };
	}

	return { ...base, ...contentOrOverrides };
}

export function makeSlackChunk(content: string, overrides?: Partial<Chunk>): Chunk {
	return makeChunk(content, {
		sourceType: "slack-message",
		source: "#foc-support",
		...overrides,
	});
}

export function makeCodeChunk(
	content: string,
	source: string,
	id = "chunk-1",
	chunkIndex = 0,
	totalChunks = 1,
): Chunk {
	return makeChunk(content, { id, sourceType: "code", source, chunkIndex, totalChunks });
}

export function makeEdge(overrides?: Partial<Edge>): Edge {
	return {
		type: "references",
		sourceId: "chunk-1",
		targetType: "issue",
		targetId: "owner/repo#42",
		evidence: "found #42",
		confidence: 1.0,
		...overrides,
	};
}

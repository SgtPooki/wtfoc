import type { Chunk, Edge, EdgeExtractor } from "@wtfoc/common";

/**
 * Describes a file changed in a PR, used to generate 'changes' edges.
 */
export interface ChangedFile {
	repo: string;
	path: string;
	commitSha: string;
}

const CLOSES_PATTERN =
	/\b(?:closes|close|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+(?:([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)#(\d+)|#(\d+))/gi;

const CROSS_REPO_PATTERN = /([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)#(\d+)/g;

const LOCAL_REF_PATTERN = /#(\d+)/g;

const GITHUB_URL_PATTERN =
	/https?:\/\/github\.com\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)\/(?:issues|pull)\/(\d+)/g;

/**
 * Regex-based edge extractor. Extracts three built-in edge types:
 *
 * - **references**: `#123`, `owner/repo#456`, GitHub issue/PR URLs
 * - **closes**: `Closes #123`, `Fixes owner/repo#456` (case-insensitive)
 * - **changes**: PR changed files (provided via metadata, not regex)
 *
 * All regex-extracted edges have `confidence: 1.0`.
 */
export class RegexEdgeExtractor implements EdgeExtractor {
	extract(chunks: Chunk[]): Edge[] {
		const edges: Edge[] = [];
		for (const chunk of chunks) {
			edges.push(...this.extractFromChunk(chunk));
		}
		return edges;
	}

	private extractFromChunk(chunk: Chunk): Edge[] {
		const edges: Edge[] = [];
		edges.push(...this.extractCloses(chunk));
		edges.push(...this.extractReferences(chunk));
		edges.push(...this.extractUrlReferences(chunk));
		return edges;
	}

	/**
	 * Extract 'closes' edges from keywords like "Closes #123", "Fixes owner/repo#456".
	 * These take priority — matched text is excluded from subsequent 'references' extraction.
	 */
	private extractCloses(chunk: Chunk): Edge[] {
		const edges: Edge[] = [];

		for (const match of chunk.content.matchAll(CLOSES_PATTERN)) {
			const repo = match[1];
			const crossRepoNum = match[2];
			const localNum = match[3];

			const targetId = repo ? `${repo}#${crossRepoNum}` : `#${localNum}`;
			edges.push({
				type: "closes",
				sourceId: chunk.id,
				targetType: "issue",
				targetId,
				evidence: match[0],
				confidence: 1.0,
			});
		}

		return edges;
	}

	/**
	 * Extract 'references' edges from `#123` and `owner/repo#456` patterns.
	 * Skips refs already captured as 'closes' edges.
	 */
	private extractReferences(chunk: Chunk): Edge[] {
		const edges: Edge[] = [];

		// Collect close targets to avoid duplicating them as references
		const closesTargets = new Set<string>();
		for (const cm of chunk.content.matchAll(CLOSES_PATTERN)) {
			const repo = cm[1];
			const crossRepoNum = cm[2];
			const localNum = cm[3];
			closesTargets.add(repo ? `${repo}#${crossRepoNum}` : `#${localNum}`);
		}

		// Match cross-repo refs first: owner/repo#123
		const matchedPositions = new Set<number>();

		for (const match of chunk.content.matchAll(CROSS_REPO_PATTERN)) {
			const targetId = `${match[1]}#${match[2]}`;
			// Always track position to prevent local pattern from re-matching the number
			matchedPositions.add((match.index ?? 0) + (match[1]?.length ?? 0));
			if (closesTargets.has(targetId)) continue;
			edges.push({
				type: "references",
				sourceId: chunk.id,
				targetType: "issue",
				targetId,
				evidence: match[0],
				confidence: 1.0,
			});
		}

		// Match local refs: #123 (but not ones already part of cross-repo refs)
		for (const match of chunk.content.matchAll(LOCAL_REF_PATTERN)) {
			if (matchedPositions.has(match.index ?? -1)) continue;
			const targetId = `#${match[1]}`;
			if (closesTargets.has(targetId)) continue;
			edges.push({
				type: "references",
				sourceId: chunk.id,
				targetType: "issue",
				targetId,
				evidence: match[0],
				confidence: 1.0,
			});
		}

		return edges;
	}

	/**
	 * Extract 'references' edges from GitHub issue/PR URLs.
	 */
	private extractUrlReferences(chunk: Chunk): Edge[] {
		const edges: Edge[] = [];

		for (const match of chunk.content.matchAll(GITHUB_URL_PATTERN)) {
			edges.push({
				type: "references",
				sourceId: chunk.id,
				targetType: "issue",
				targetId: `${match[1]}#${match[2]}`,
				evidence: match[0],
				confidence: 1.0,
			});
		}

		return edges;
	}
}

/**
 * Extract 'changes' edges from a list of changed files associated with a chunk (typically a PR).
 * These edges link a PR chunk to the files it modified.
 */
export function extractChangedFileEdges(chunkId: string, files: ChangedFile[]): Edge[] {
	return files.map((file) => ({
		type: "changes",
		sourceId: chunkId,
		targetType: "file",
		targetId: `${file.repo}:${file.path}@${file.commitSha}`,
		evidence: `Changed file: ${file.path}`,
		confidence: 1.0,
	}));
}

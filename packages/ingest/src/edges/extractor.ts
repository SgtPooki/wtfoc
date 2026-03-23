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

const GITHUB_SOURCE_TYPES = new Set(["github-pr", "github-issue"]);
const SOURCE_REPO_PATTERN = /^([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)#\d+$/;

/**
 * Extract repo context from a GitHub chunk's `source` field (e.g. "owner/repo#10" → "owner/repo").
 * Returns undefined for non-GitHub chunks or unparseable sources.
 */
function repoFromChunk(chunk: Chunk): string | undefined {
	if (!GITHUB_SOURCE_TYPES.has(chunk.sourceType)) return undefined;
	const match = SOURCE_REPO_PATTERN.exec(chunk.source);
	return match?.[1];
}

/**
 * Regex-based edge extractor. Extracts two built-in edge types from text:
 *
 * - **references**: `#123`, `owner/repo#456`, GitHub issue/PR URLs
 * - **closes**: `Closes #123`, `Fixes owner/repo#456` (case-insensitive)
 *
 * For GitHub chunks (`sourceType: 'github-pr'` or `'github-issue'`), bare local
 * refs like `#123` are normalized to repo-scoped `owner/repo#123` using the repo
 * from `chunk.source`.
 *
 * For `changes` edges (PR changed files), use the standalone `extractChangedFileEdges` helper.
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
		const repo = repoFromChunk(chunk);
		const edges: Edge[] = [];
		edges.push(...this.extractCloses(chunk, repo));
		edges.push(...this.extractReferences(chunk, repo));
		edges.push(...this.extractUrlReferences(chunk));
		return edges;
	}

	/**
	 * Extract 'closes' edges from keywords like "Closes #123", "Fixes owner/repo#456".
	 * These take priority — any references to the same targets are not emitted as
	 * separate 'references' edges.
	 */
	private extractCloses(chunk: Chunk, chunkRepo: string | undefined): Edge[] {
		const edges: Edge[] = [];

		for (const match of chunk.content.matchAll(CLOSES_PATTERN)) {
			const matchRepo = match[1];
			const crossRepoNum = match[2];
			const localNum = match[3];

			const targetId = matchRepo
				? `${matchRepo}#${crossRepoNum}`
				: chunkRepo
					? `${chunkRepo}#${localNum}`
					: `#${localNum}`;
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
	 * Skips refs already captured as 'closes' edges (matched by targetId).
	 */
	private extractReferences(chunk: Chunk, chunkRepo: string | undefined): Edge[] {
		const edges: Edge[] = [];

		// Collect close targets to avoid duplicating them as references
		const closesTargets = new Set<string>();
		for (const cm of chunk.content.matchAll(CLOSES_PATTERN)) {
			const matchRepo = cm[1];
			const crossRepoNum = cm[2];
			const localNum = cm[3];
			closesTargets.add(
				matchRepo
					? `${matchRepo}#${crossRepoNum}`
					: chunkRepo
						? `${chunkRepo}#${localNum}`
						: `#${localNum}`,
			);
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
			const targetId = chunkRepo ? `${chunkRepo}#${match[1]}` : `#${match[1]}`;
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

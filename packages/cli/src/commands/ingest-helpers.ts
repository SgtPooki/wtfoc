import type { DocumentCatalog, Embedder, SourceAdapter, StorageBackend } from "@wtfoc/common";
import type {
	CursorData,
	IngestOptions,
	IngestResult,
	LlmEdgeExtractorOptions,
	PublishSegmentResult,
	RawSourceIndex,
} from "@wtfoc/ingest";
import {
	CodeEdgeExtractor,
	CompositeEdgeExtractor,
	getCursorSince,
	HeuristicEdgeExtractor,
	LlmEdgeExtractor,
	RegexEdgeExtractor,
	TreeSitterEdgeExtractor,
	writeCursors,
} from "@wtfoc/ingest";

/** Validate and apply website-specific options to raw config. */
export function applyWebsiteOptions(
	rawConfig: Record<string, unknown>,
	opts: { maxPages?: string; depth?: string; urlPattern?: string },
	quiet: boolean,
): void {
	if (opts.maxPages != null) {
		const maxPages = Number(opts.maxPages);
		if (!Number.isInteger(maxPages) || maxPages < -1) {
			console.error(
				`Error: --max-pages must be a positive integer or -1 for unlimited, got "${opts.maxPages}".`,
			);
			process.exit(2);
		}
		rawConfig.maxPages = maxPages;
	}
	if (opts.depth != null) {
		const depth = Number(opts.depth);
		if (!Number.isInteger(depth) || depth < 0) {
			console.error(`Error: --depth must be a non-negative integer, got "${opts.depth}".`);
			process.exit(2);
		}
		rawConfig.depth = depth;
	}
	if (opts.urlPattern) rawConfig.urlPattern = opts.urlPattern;
	if (quiet) rawConfig.quiet = true;
}

/** Format ingest result as human-readable summary. */
export function formatIngestSummary(
	result: IngestResult,
	sourceArg: string,
	collection: string,
): string {
	const parts = [`${result.chunksIngested} chunks`];
	if (result.batchesWritten > 1) parts[0] += ` (${result.batchesWritten} batches)`;
	if (result.rechunkedCount > 0) parts.push(`${result.rechunkedCount} from oversized splits`);
	if (result.chunksSkipped > 0) parts.push(`${result.chunksSkipped} skipped as duplicates`);
	if (result.chunksFiltered > 0) parts.push(`${result.chunksFiltered} filtered out`);
	if (result.docsSuperseded > 0) parts.push(`${result.docsSuperseded} documents superseded`);
	if (result.reusedFromDonors > 0) {
		parts.push(
			`${result.reusedFromDonors} pre-cached from ${result.donorCollectionNames.join(", ")}`,
		);
	}
	return `✅ Ingested ${parts.join(", ")} from ${sourceArg} into "${collection}"`;
}

/** Apply repo adapter config (ignore patterns, quiet mode, last commit SHA). */
export function applyRepoConfig(
	config: unknown,
	sourceKey: string,
	cursorData: CursorData | null,
	projectIgnore: string[] | undefined,
	cliIgnore: string[] | undefined,
	quiet: boolean,
): void {
	const ac = config as Record<string, unknown>;
	ac.ignorePatternSources = [projectIgnore, cliIgnore];
	ac.quiet = quiet;
	const storedCursor = getCursorSince(cursorData, sourceKey);
	if (storedCursor?.match(/^[0-9a-f]{40}$/)) ac.lastCommitSha = storedCursor;
}

/** Extract repo HEAD SHA from adapter metadata (if available). */
export function extractRepoHeadSha(
	adapter: SourceAdapter,
	sourceType: string,
	isPartialRun: boolean,
): string | null {
	if (isPartialRun || sourceType !== "repo" || !("lastIngestMetadata" in adapter)) return null;
	return (
		(adapter as { lastIngestMetadata: { headCommitSha: string | null } | null }).lastIngestMetadata
			?.headCommitSha ?? null
	);
}

/** Extract renames from repo adapter metadata. */
export function extractRenames(
	adapter: SourceAdapter,
	sourceType: string,
	isPartialRun: boolean,
): Array<{ oldPath: string; newPath: string }> | undefined {
	if (isPartialRun || sourceType !== "repo" || !("lastIngestMetadata" in adapter)) return undefined;
	return (
		adapter as {
			lastIngestMetadata: { renamedFiles: Array<{ oldPath: string; newPath: string }> } | null;
		}
	).lastIngestMetadata?.renamedFiles;
}

/** Build IngestOptions from CLI params. */
export function buildIngestOptions(params: {
	collection: string;
	collectionId: string;
	sourceType: string;
	sourceKey: string;
	config: Record<string, unknown>;
	batchSize: string;
	maxChunkChars: string | undefined;
	embedder: Embedder;
	defaultMaxChunkChars: number;
	isPartialRun: boolean;
	documentIds: string[] | undefined;
	sourcePaths: string[] | undefined;
	changedSince: string | undefined;
	modelName: string;
	sourceReuse: boolean;
	reuseDonorChunks: boolean;
	sourceArg: string;
	extractorConfig: IngestOptions["extractorConfig"];
	treeSitterUrl: string | null;
	manifestDir: string;
	description: string | undefined;
	catalog: DocumentCatalog;
	archiveIndex: RawSourceIndex;
	adapter: SourceAdapter;
	cursorData: CursorData | null;
}): IngestOptions {
	const p = params;
	return {
		collectionName: p.collection,
		collectionId: p.collectionId,
		sourceType: p.sourceType,
		sourceKey: p.sourceKey,
		adapterConfig: p.config,
		maxBatch: Number.parseInt(p.batchSize, 10) || 500,
		maxChunkChars: p.maxChunkChars
			? Number.parseInt(p.maxChunkChars, 10)
			: (p.embedder.maxInputChars ?? p.defaultMaxChunkChars),
		isPartialRun: p.isPartialRun,
		filters: {
			documentIds: p.documentIds ? new Set(p.documentIds) : null,
			sourcePaths: p.sourcePaths ?? null,
			changedSinceMs: p.changedSince ? new Date(p.changedSince).getTime() : null,
		},
		modelName: p.modelName,
		sourceReuse: p.sourceReuse,
		reuseDonorChunks: p.reuseDonorChunks,
		repoArg: p.sourceType === "repo" ? p.sourceArg : undefined,
		appendOnlyTypes: new Set(["hn-story", "hn-comment"]),
		extractorConfig: p.extractorConfig,
		treeSitterUrl: p.treeSitterUrl,
		manifestDir: p.manifestDir,
		description: p.description,
		catalog: p.catalog,
		archiveIndex: p.archiveIndex,
		repoHeadSha: extractRepoHeadSha(p.adapter, p.sourceType, p.isPartialRun),
		existingCursorValue: p.cursorData?.cursors?.[p.sourceKey]?.cursorValue ?? null,
		renames: extractRenames(p.adapter, p.sourceType, p.isPartialRun),
	};
}

/** Create a publishSegment function for FOC or local storage. */
export function createPublishSegment(
	storageType: string,
	storage: StorageBackend,
	bundleAndUploadFn: (
		items: Array<{ id: string; data: Uint8Array }>,
		storage: StorageBackend,
	) => Promise<{ segmentCids: Map<string, string>; batch: import("@wtfoc/common").BatchRecord }>,
): (bytes: Uint8Array, segId: string) => Promise<PublishSegmentResult> {
	return async (bytes, segId) => {
		if (storageType === "foc") {
			const br = await bundleAndUploadFn([{ id: segId, data: bytes }], storage);
			return {
				resultId: br.segmentCids.get(segId) ?? segId,
				batchRecord: br.batch,
			} as PublishSegmentResult;
		}
		const sr = await storage.upload(bytes);
		return { resultId: sr.id };
	};
}

/** Create an edge extractor factory. */
export function createEdgeExtractorFactory(
	treeSitterUrl: string | null,
	extractorConfig: { enabled: boolean } & Partial<LlmEdgeExtractorOptions>,
): () => CompositeEdgeExtractor {
	return () => {
		const ce = new CompositeEdgeExtractor();
		ce.register({ name: "regex", extractor: new RegexEdgeExtractor() });
		ce.register({ name: "heuristic", extractor: new HeuristicEdgeExtractor() });
		ce.register({ name: "code", extractor: new CodeEdgeExtractor() });
		if (treeSitterUrl)
			ce.register({
				name: "tree-sitter",
				extractor: new TreeSitterEdgeExtractor({ baseUrl: treeSitterUrl }),
			});
		if (extractorConfig.enabled)
			ce.register({
				name: "llm",
				extractor: new LlmEdgeExtractor(extractorConfig as LlmEdgeExtractorOptions),
			});
		return ce;
	};
}

/** Persist cursor data after successful ingest. */
export async function persistCursor(
	cursorPath: string,
	cursorData: CursorData | null,
	sourceKey: string,
	sourceType: string,
	result: IngestResult,
): Promise<void> {
	if (!result.cursorValue) return;
	const updated = cursorData ?? { schemaVersion: 1 as const, cursors: {} };
	updated.cursors[sourceKey] = {
		sourceKey,
		adapterType: sourceType,
		cursorValue: result.cursorValue,
		lastRunAt: new Date().toISOString(),
		chunksIngested: result.chunksIngested,
	};
	await writeCursors(cursorPath, updated);
}

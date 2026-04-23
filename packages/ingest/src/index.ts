// @wtfoc/ingest — Source adapters + chunking + edge extraction
// See SPEC.md for ingest architecture

export { getAdapter, getAvailableSourceTypes, registerAdapter } from "./adapter-registry.js";
export { DiscordAdapter, type DiscordAdapterConfig } from "./adapters/discord.js";
export {
	createHttpExecFn,
	resolveGitHubExecFn,
	type TaggedExecFn,
	type TokenProvider,
} from "./adapters/github/http-transport.js";
export {
	decodePrivateKey,
	type ExecFn,
	GitHubAdapter,
	type GitHubAdapterConfig,
	type GitHubAppConfig,
	type GitHubAppJwtOptions,
	GitHubAppTokenProvider,
	type GitHubOAuthConfig,
	type GitHubOAuthTokenData,
	GitHubOAuthTokenProvider,
	type GitHubTokenProvider,
	PatTokenProvider,
	signGitHubAppJwt,
} from "./adapters/github/index.js";
export { HackerNewsAdapter, type HackerNewsAdapterConfig } from "./adapters/hackernews.js";
export { RepoAdapter, type RepoAdapterConfig } from "./adapters/repo/index.js";
export { SlackAdapter, type SlackAdapterConfig } from "./adapters/slack.js";
export { WebsiteAdapter, type WebsiteAdapterConfig } from "./adapters/website.js";
export {
	chunkMarkdown,
	DEFAULT_MAX_CHUNK_CHARS,
	type MarkdownChunkerOptions,
	rechunkOversized,
	sha256Hex,
} from "./chunker.js";
export type { AstChunkerOptions } from "./chunkers/index.js";
export {
	AstChunker,
	AstHeuristicChunker,
	CodeWindowChunker,
	getAvailableChunkers,
	getChunker,
	MarkdownChunker,
	registerChunker,
	selectChunker,
} from "./chunkers/index.js";
export {
	buildEnrichedCollectionHead,
	collectPromotableArtifacts,
	enumeratePromotableArtifacts,
	type PromotableArtifact,
	type PromotableArtifactMetadata,
	sha256HexBytes,
	sidecarId,
	toPublishedArtifactRef,
} from "./collection-artifacts.js";
export {
	buildSourceKey,
	type CursorData,
	cursorFilePath,
	getCursorSince,
	readCursors,
	type SourceCursor,
	writeCursors,
} from "./cursor-store.js";
export {
	archiveDocument,
	catalogFilePath,
	createEmptyCatalog,
	getActiveChunkIds,
	getChunkIdsByState,
	getDocument,
	getSupersededChunkIds,
	readCatalog,
	renameDocument,
	type UpdateDocumentOptions,
	updateDocument,
	writeCatalog,
} from "./document-catalog.js";
export { CodeEdgeExtractor } from "./edges/code.js";
export { CompositeEdgeExtractor } from "./edges/composite.js";
export { extractPackageJsonDeps, extractRequirementsTxtDeps } from "./edges/dependency-parser.js";
export {
	buildDerivedEdgeLayer,
	type CompactionStats,
	compactDerivedLayers,
	type DerivedEdgeLayer,
	derivedLayerId,
	loadDerivedEdgeLayers,
	parseDerivedEdgeLayer,
} from "./edges/derived-layer.js";
export { type ValidationResult, validateEdges } from "./edges/edge-validator.js";
export {
	type ContextStatus,
	computeContextHash,
	type ExtractionStatusData,
	getContextsToProcess,
	readExtractionStatus,
	writeExtractionStatus,
} from "./edges/extraction-status.js";
export type { ChangedFile } from "./edges/extractor.js";
export {
	buildBatchRepoAffinity,
	extractChangedFileEdges,
	inferRepoFromContent,
	RegexEdgeExtractor,
} from "./edges/extractor.js";
export { HeuristicEdgeExtractor } from "./edges/heuristic.js";
export { LlmEdgeExtractor, type LlmEdgeExtractorOptions } from "./edges/llm.js";
export type { LlmClientOptions } from "./edges/llm-client.js";
export { chatCompletion, parseJsonResponse } from "./edges/llm-client.js";
export {
	buildExtractionMessages,
	estimatePromptOverhead,
	estimateTokens,
} from "./edges/llm-prompt.js";
export { edgeKey, mergeEdges } from "./edges/merge.js";
export {
	listExtractorOverlayIds,
	loadAllOverlayEdges,
	mergeOverlayEdges,
	type OverlayEdgeData,
	overlayFilePath,
	overlayRootDir,
	readOverlayEdges,
	statusFilePath,
	writeOverlayEdges,
} from "./edges/overlay-store.js";
export { StructuralEdgeExtractor } from "./edges/structural.js";
export { TemporalEdgeExtractor, type TemporalEdgeExtractorOptions } from "./edges/temporal.js";
export {
	type TemporalEdgeType,
	type TemporalEvent,
	type TemporalExtractionResult,
	TemporalSemanticExtractor,
	type TemporalSemanticOptions,
} from "./edges/temporal-semantic.js";
export {
	TreeSitterEdgeExtractor,
	type TreeSitterEdgeExtractorOptions,
} from "./edges/tree-sitter.js";
export type {
	TreeSitterClientOptions,
	TreeSitterEdge,
	TreeSitterHealthResponse,
	TreeSitterParseResponse,
} from "./edges/tree-sitter-client.js";
export { treeSitterHealth, treeSitterParse } from "./edges/tree-sitter-client.js";
export { evaluateEdgeExtraction } from "./eval/edge-extraction-evaluator.js";
// Eval evaluators
export { evaluateIngest } from "./eval/ingest-evaluator.js";
export { evaluateSignals } from "./eval/signal-evaluator.js";
export type {
	CatalogUpdateResult,
	CreateEdgeExtractorFn,
	CursorDecision,
	CursorDecisionInput,
	DedupSets,
	DocumentFilters,
	DonorReuseDeps,
	ExtractorConfig,
	FlushBatchDeps,
	FlushBatchResult,
	IngestOptions,
	IngestResult,
	LogEvent,
	LogSink,
	OrchestrateDeps,
	PipelineState,
	PipelineStats,
	ProcessStreamDeps,
	PublishSegmentFn,
	PublishSegmentResult,
} from "./pipeline/index.js";
// Pipeline — composable ingest stages with dependency injection
export {
	buildDedupSetsFromCatalog,
	buildDedupSetsFromSegments,
	decideCursorValue,
	flushBatch,
	handleRenames,
	orchestrate,
	pickArchiveMetadata,
	processStream,
	reuseDonorSources,
	shouldIncludeChunk,
	updateCatalogFromChunks,
} from "./pipeline/index.js";
export {
	archiveIndexPath,
	archiveKey,
	archiveRawSource,
	createEmptyArchiveIndex,
	findEntriesBySourceKey,
	inferMediaType,
	isArchived,
	type RawSourceEntry,
	type RawSourceIndex,
	readArchiveIndex,
	writeArchiveIndex,
} from "./raw-source-archive.js";
export { HeuristicChunkScorer } from "./scoring.js";
export {
	buildSegment,
	extractSegmentMetadata,
	type SegmentBuilderOptions,
	type SegmentChunk,
	segmentId,
	storedChunkToSegmentChunk,
} from "./segment-builder.js";
export {
	DEFAULT_TIMESTAMP_KIND_BY_SOURCE_TYPE,
	deriveReplayTimestamp,
	type RawSourceDocument,
	replayFromArchive,
	replayRawDocuments,
} from "./source-replay.js";
export {
	type ScanResult,
	type SourceMatch,
	scanForReusableSources,
	validateDonorEntry,
} from "./source-scanner.js";

// Register built-in adapters
import { registerAdapter as _register } from "./adapter-registry.js";
import { DiscordAdapter as _DiscordAdapter } from "./adapters/discord.js";
import { resolveGitHubExecFn as _resolveGitHubExecFn } from "./adapters/github/http-transport.js";
import { GitHubAdapter as _GitHubAdapter } from "./adapters/github/index.js";
import { HackerNewsAdapter as _HackerNewsAdapter } from "./adapters/hackernews.js";
import { RepoAdapter as _RepoAdapter } from "./adapters/repo/index.js";
import { SlackAdapter as _SlackAdapter } from "./adapters/slack.js";
import { WebsiteAdapter as _WebsiteAdapter } from "./adapters/website.js";

_register(new _RepoAdapter());
_register(new _GitHubAdapter(_resolveGitHubExecFn()));
_register(new _HackerNewsAdapter());
_register(new _WebsiteAdapter());
_register(new _DiscordAdapter());
_register(new _SlackAdapter());

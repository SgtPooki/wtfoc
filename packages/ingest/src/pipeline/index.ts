// Pipeline — composable ingest stages with dependency injection

export type { DedupSets } from "./build-dedup-sets.js";

export { buildDedupSetsFromCatalog, buildDedupSetsFromSegments } from "./build-dedup-sets.js";
export type { DonorReuseDeps } from "./donor-reuse.js";
export { reuseDonorSources } from "./donor-reuse.js";
export type { FlushBatchDeps, FlushBatchResult } from "./flush-batch.js";
export { flushBatch } from "./flush-batch.js";
export { orchestrate } from "./orchestrate.js";
export type { CursorDecision, CursorDecisionInput } from "./persist-cursor.js";
export { decideCursorValue } from "./persist-cursor.js";
export type { ProcessStreamDeps } from "./process-stream.js";
export { processStream, shouldIncludeChunk } from "./process-stream.js";
export type {
	CreateEdgeExtractorFn,
	DocumentFilters,
	ExtractorConfig,
	IngestOptions,
	IngestResult,
	LogEvent,
	LogSink,
	OrchestrateDeps,
	PipelineState,
	PipelineStats,
	PublishSegmentFn,
	PublishSegmentResult,
} from "./types.js";
export type { CatalogUpdateResult } from "./update-catalog.js";
export { handleRenames, updateCatalogFromChunks } from "./update-catalog.js";

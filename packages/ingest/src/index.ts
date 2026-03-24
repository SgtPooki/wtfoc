// @wtfoc/ingest — Source adapters + chunking + edge extraction
// See SPEC.md for ingest architecture

export { DiscordAdapter, type DiscordAdapterConfig } from "./adapters/discord.js";
export { type ExecFn, GitHubAdapter, type GitHubAdapterConfig } from "./adapters/github.js";
export { RepoAdapter, type RepoAdapterConfig } from "./adapters/repo.js";
export { chunkMarkdown, type MarkdownChunkerOptions } from "./chunker.js";
export type { ChangedFile } from "./edges/extractor.js";
export { extractChangedFileEdges, RegexEdgeExtractor } from "./edges/extractor.js";
export {
	buildSegment,
	type SegmentBuilderOptions,
	type SegmentChunk,
	segmentId,
} from "./segment-builder.js";

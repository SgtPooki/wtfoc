// @wtfoc/ingest — Source adapters + chunking + edge extraction
// See SPEC.md for ingest architecture

export { getAdapter, getAvailableSourceTypes, registerAdapter } from "./adapter-registry.js";
export { type ExecFn, GitHubAdapter, type GitHubAdapterConfig } from "./adapters/github.js";
export { RepoAdapter, type RepoAdapterConfig } from "./adapters/repo.js";
export { WebsiteAdapter, type WebsiteAdapterConfig } from "./adapters/website.js";
export { chunkMarkdown, type MarkdownChunkerOptions } from "./chunker.js";
export type { ChangedFile } from "./edges/extractor.js";
export { extractChangedFileEdges, RegexEdgeExtractor } from "./edges/extractor.js";
export {
	buildSegment,
	type SegmentBuilderOptions,
	type SegmentChunk,
	segmentId,
} from "./segment-builder.js";

// Register built-in adapters
import { registerAdapter as _register } from "./adapter-registry.js";
import { GitHubAdapter as _GitHubAdapter } from "./adapters/github.js";
import { RepoAdapter as _RepoAdapter } from "./adapters/repo.js";

_register(new _RepoAdapter());
_register(new _GitHubAdapter());

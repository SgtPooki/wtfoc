// @wtfoc/ingest — Source adapters + chunking + edge extraction
// See SPEC.md for ingest architecture

export { getAdapter, getAvailableSourceTypes, registerAdapter } from "./adapter-registry.js";
export { DiscordAdapter, type DiscordAdapterConfig } from "./adapters/discord.js";
export { type ExecFn, GitHubAdapter, type GitHubAdapterConfig } from "./adapters/github/index.js";
export { HackerNewsAdapter, type HackerNewsAdapterConfig } from "./adapters/hackernews.js";
export { RepoAdapter, type RepoAdapterConfig } from "./adapters/repo/index.js";
export { SlackAdapter, type SlackAdapterConfig } from "./adapters/slack.js";
export { WebsiteAdapter, type WebsiteAdapterConfig } from "./adapters/website.js";
export {
	chunkMarkdown,
	DEFAULT_MAX_CHUNK_CHARS,
	type MarkdownChunkerOptions,
	rechunkOversized,
} from "./chunker.js";
export type { ChangedFile } from "./edges/extractor.js";
export {
	buildBatchRepoAffinity,
	extractChangedFileEdges,
	inferRepoFromContent,
	RegexEdgeExtractor,
} from "./edges/extractor.js";
export {
	buildSegment,
	type SegmentBuilderOptions,
	type SegmentChunk,
	segmentId,
} from "./segment-builder.js";

// Register built-in adapters
import { registerAdapter as _register } from "./adapter-registry.js";
import { DiscordAdapter as _DiscordAdapter } from "./adapters/discord.js";
import { GitHubAdapter as _GitHubAdapter } from "./adapters/github/index.js";
import { HackerNewsAdapter as _HackerNewsAdapter } from "./adapters/hackernews.js";
import { RepoAdapter as _RepoAdapter } from "./adapters/repo/index.js";
import { SlackAdapter as _SlackAdapter } from "./adapters/slack.js";
import { WebsiteAdapter as _WebsiteAdapter } from "./adapters/website.js";

_register(new _RepoAdapter());
_register(new _GitHubAdapter());
_register(new _HackerNewsAdapter());
_register(new _WebsiteAdapter());
_register(new _DiscordAdapter());
_register(new _SlackAdapter());

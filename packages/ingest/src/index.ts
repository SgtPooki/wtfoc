// @wtfoc/ingest — Source adapters + chunking + edge extraction
// See SPEC.md for ingest architecture

export type { ChangedFile } from "./edges/extractor.js";
export { extractChangedFileEdges, RegexEdgeExtractor } from "./edges/extractor.js";

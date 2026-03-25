export type { ChunkData, ChunkIndexes } from "./indexing.js";
export { buildChunkIndexes, buildEdgeIndex } from "./indexing.js";
export { findChunksByTarget } from "./resolution.js";
export type { TraceHop, TraceOptions, TraceResult } from "./trace.js";
export { trace } from "./trace.js";
export { followEdges } from "./traversal.js";

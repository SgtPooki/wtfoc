# @wtfoc/search

Embedding, vector search, edge resolution, and cross-source tracing for [wtfoc](https://github.com/SgtPooki/wtfoc).

## Install

```bash
npm install @wtfoc/search
```

## Features

- **Embedders** — local (transformers.js) or OpenAI-based text embedding
- **Vector index** — in-memory nearest-neighbor search
- **Semantic query** — ranked chunk retrieval by similarity
- **Trace engine** — follow edges across sources to build evidence chains
- **Edge resolution** — analyze how well cross-source references resolve
- **Collection mounting** — load a stored collection into a queryable index

## Usage

```typescript
import {
  TransformersEmbedder,
  InMemoryVectorIndex,
  mountCollection,
  query,
  trace,
} from '@wtfoc/search';

// Set up embedder and index
const embedder = new TransformersEmbedder();
const vectorIndex = new InMemoryVectorIndex();

// Mount a collection (loads segments into the vector index)
const mounted = await mountCollection(manifest, storage, vectorIndex);

// Semantic search
const results = await query('upload failures', embedder, vectorIndex, { topK: 10 });

// Cross-source trace — follows edges to build evidence chains
const traceResult = await trace('upload failures', embedder, vectorIndex, mounted.segments);
```

### Edge Resolution

```typescript
import { buildSourceIndex, analyzeEdgeResolution } from '@wtfoc/search';

const sourceIndex = buildSourceIndex(mounted.segments);
const stats = analyzeEdgeResolution(mounted.segments, sourceIndex);
// stats.totalEdges, stats.resolvedEdges, stats.unresolvedEdges
```

## Related Packages

- [`@wtfoc/common`](../common/) — `Embedder` and `VectorIndex` interfaces
- [`@wtfoc/store`](../store/) — Loads collections for mounting
- [`@wtfoc/ingest`](../ingest/) — Produces the chunks and edges this package indexes
- [`@wtfoc/cli`](../cli/) — `wtfoc query` and `wtfoc trace` commands

## License

MIT

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
const index = new InMemoryVectorIndex();

// Mount a collection for querying
const mounted = await mountCollection(store, 'my-collection', { embedder, index });

// Semantic search
const results = await query(index, embedder, 'upload failures', { topK: 10 });

// Cross-source trace — follows edges to build evidence chains
const traceResult = await trace(index, embedder, store, 'upload failures', {
  collection: 'my-collection',
});
```

### Edge Resolution

```typescript
import { buildSourceIndex, analyzeEdgeResolution } from '@wtfoc/search';

const sourceIndex = buildSourceIndex(chunks);
const stats = analyzeEdgeResolution(edges, sourceIndex);
// stats.resolved, stats.unresolved, stats.resolutionRate
```

## Related Packages

- [`@wtfoc/common`](../common/) — `Embedder` and `VectorIndex` interfaces
- [`@wtfoc/store`](../store/) — Loads collections for mounting
- [`@wtfoc/ingest`](../ingest/) — Produces the chunks and edges this package indexes
- [`@wtfoc/cli`](../cli/) — `wtfoc query` and `wtfoc trace` commands

## License

MIT

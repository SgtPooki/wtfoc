# Quickstart: Incremental Ingest Pipeline

## Usage

### Incremental Ingest (automatic)

```bash
# First run: fetches everything, saves cursor
wtfoc ingest github owner/repo -c my-collection

# Second run: automatically fetches only new/updated items
wtfoc ingest github owner/repo -c my-collection

# Override stored cursor with explicit --since
wtfoc ingest github owner/repo -c my-collection --since 7d
```

### Incremental Mount (skip already-indexed segments)

When using a persistent vector backend (e.g., Qdrant), the mount function now accepts `skipSegmentIds` to avoid re-indexing segments that are already in the vector store:

```typescript
import { mountCollection } from '@wtfoc/search'

// Track which segments are already indexed
const indexedSegmentIds = new Set(['seg-abc123', 'seg-def456'])

const mounted = await mountCollection(head, storage, vectorIndex, {
  skipSegmentIds: indexedSegmentIds,
})
// Only new segments are downloaded and indexed
```

### Partial Re-chunk

```bash
# Only re-chunks segments with oversized chunks; preserves the rest
wtfoc reindex -c my-collection --rechunk --max-chunk-chars 2000
```

## Development

```bash
# Run all tests
pnpm test

# Run tests for specific packages
pnpm --filter @wtfoc/ingest test
pnpm --filter @wtfoc/search test
pnpm --filter @wtfoc/cli test
```

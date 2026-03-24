# @wtfoc/common

Shared types, interfaces, and schemas for the [wtfoc](https://github.com/SgtPooki/wtfoc) knowledge graph.

## Install

```bash
npm install @wtfoc/common
```

## What's Inside

This package contains zero runtime logic — only contracts that the rest of the wtfoc stack depends on.

### Interfaces (seams)

| Interface | Purpose |
|-----------|---------|
| `Embedder` | Text → vector embedding |
| `VectorIndex` | Store and query embeddings |
| `StorageBackend` | Put/get content-addressed blobs (local, FOC) |
| `ManifestStore` | Read/write collection head manifests |
| `SourceAdapter` | Ingest a source type into chunks + edges |
| `EdgeExtractor` | Extract relationship edges from chunks |

### Schemas

| Schema | Purpose |
|--------|---------|
| `Chunk` | A single piece of ingested content |
| `Edge` | A relationship between two chunks |
| `CollectionHead` / `CollectionRevision` | Collection state and history |
| `Segment` | A group of related chunks |

### Errors

Typed error classes (`WtfocError` base) for storage, embedding, GitHub API, schema validation, and more.

## Usage

```typescript
import type { Embedder, VectorIndex, Chunk } from '@wtfoc/common';
import { CURRENT_SCHEMA_VERSION } from '@wtfoc/common';
```

## Related Packages

- [`@wtfoc/store`](../store/) — Storage backends implementing `StorageBackend` and `ManifestStore`
- [`@wtfoc/ingest`](../ingest/) — Source adapters implementing `SourceAdapter`
- [`@wtfoc/search`](../search/) — Embedders and vector indices implementing `Embedder` and `VectorIndex`
- [`@wtfoc/cli`](../cli/) — CLI that ties everything together

## License

MIT

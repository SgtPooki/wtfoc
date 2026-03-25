# @wtfoc/ingest

Source adapters, chunking, and edge extraction for [wtfoc](https://github.com/SgtPooki/wtfoc).

## Install

```bash
npm install @wtfoc/ingest
```

## Supported Sources

| Adapter | Input | What It Ingests |
|---------|-------|-----------------|
| `github` | `owner/repo` | Issues, PRs, comments, reviews (via `gh` CLI) |
| `repo` | Local path or git URL | Source code files, chunked as markdown |
| `slack` | Slack export JSON | Channel messages and threads |
| `discord` | Discord export JSON | Channel messages and threads |
| `website` | URL | Crawled web pages |
| `hackernews` | Search query | Stories, comments, and discussions |

## Usage

```typescript
import { getAdapter, chunkMarkdown, buildSegment, RegexEdgeExtractor } from '@wtfoc/ingest';

// Get a registered source adapter
const adapter = getAdapter('github');

// Chunk raw markdown content
const chunks = chunkMarkdown(content, { source: 'docs/README.md' });

// Extract cross-source edges (issue refs, PR links, URLs)
const extractor = new RegexEdgeExtractor();
const edges = extractor.extract(chunks);

// Build a segment from chunks + embeddings + edges
// embedder.embedBatch() returns Float32Array[] — convert to number[] for storage
const embeddings = await embedder.embedBatch(chunks.map(c => c.content));
const segmentChunks = chunks.map((chunk, i) => ({ chunk, embedding: Array.from(embeddings[i]) }));
const segment = buildSegment(segmentChunks, edges, {
  embeddingModel: 'nomic-embed-text',
  embeddingDimensions: 768,
});
```

### Custom Adapters

```typescript
import { registerAdapter } from '@wtfoc/ingest';
import type { SourceAdapter } from '@wtfoc/common';

class JiraAdapter implements SourceAdapter {
  // ...implement the interface
}

registerAdapter(new JiraAdapter());
```

## Related Packages

- [`@wtfoc/common`](../common/) — `SourceAdapter` and `EdgeExtractor` interfaces
- [`@wtfoc/store`](../store/) — Stores the segments this package produces
- [`@wtfoc/search`](../search/) — Indexes and queries ingested content
- [`@wtfoc/cli`](../cli/) — `wtfoc ingest` command

## License

MIT

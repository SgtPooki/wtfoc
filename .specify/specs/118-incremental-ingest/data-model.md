# Data Model: Incremental Ingest Pipeline

## IngestCursorStore

Sidecar file per collection: `{manifestDir}/{collectionName}.ingest-cursors.json`

### CursorData (root)

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `1` | For future format migrations |
| `cursors` | `Record<string, SourceCursor>` | Keyed by source identifier (`{adapterType}:{sourceArg}`) |

### SourceCursor

| Field | Type | Description |
|-------|------|-------------|
| `sourceKey` | `string` | Matches the record key (e.g., `github:owner/repo`) |
| `adapterType` | `string` | Adapter that produced this cursor (e.g., `github`, `repo`) |
| `cursorValue` | `string` | The resume position — ISO timestamp for time-based sources |
| `lastRunAt` | `string` | ISO timestamp of when the successful ingest completed |
| `chunksIngested` | `number` | Total chunks produced in the last run (informational) |

### Lifecycle

1. **Before ingest**: Read cursor file → look up source key → pass `cursorValue` as `since` to adapter
2. **After successful ingest**: Compute max timestamp from ingested items → write cursor
3. **On failure**: Do NOT update cursor — next run retries from same position
4. **Manual override**: `--since` flag takes precedence over stored cursor

## MountOptions Extension

### IndexedSegmentTracking

| Field | Type | Description |
|-------|------|-------------|
| `skipSegmentIds` | `Set<string>` | Segment IDs to skip during mount (already indexed) |

Added as an optional field on the existing `MountOptions` interface in `@wtfoc/search`.

## Relationships

```
CollectionHead (existing)
  └── segments[].id ──────────┐
                               ├── compared against skipSegmentIds during mount
IngestCursorStore (new)        │
  └── cursors[sourceKey]       │
       └── cursorValue ──→ adapter.ingest(config.since)
                               │
VectorIndex (existing)         │
  └── entries ←── only new segments indexed
```

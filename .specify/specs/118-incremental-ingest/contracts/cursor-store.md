# Contract: Cursor Store

## Functions

### `readCursors(cursorPath: string): Promise<CursorData | null>`

Read cursor data from disk. Returns `null` if file doesn't exist.

### `writeCursors(cursorPath: string, data: CursorData): Promise<void>`

Write cursor data atomically (temp + rename). Creates parent directories if needed.

### `cursorFilePath(manifestDir: string, collectionName: string): string`

Returns `{manifestDir}/{collectionName}.ingest-cursors.json`.

### `getCursorSince(data: CursorData | null, sourceKey: string): string | undefined`

Extract the `cursorValue` for a given source key, or `undefined` if no cursor exists.

### `buildSourceKey(adapterType: string, sourceArg: string): string`

Returns `{adapterType}:{sourceArg}`.

## CLI Contract

### `wtfoc ingest` Behavior Changes

| Scenario | Current Behavior | New Behavior |
|----------|-----------------|--------------|
| First ingest | Fetch all | Fetch all, save cursor |
| Re-ingest, no `--since` | Fetch all, dedup | Fetch only new items via stored cursor |
| Re-ingest with `--since` | Fetch since explicit date | Explicit `--since` overrides stored cursor |
| Failed ingest | No cursor exists | Cursor NOT updated on failure |

### `wtfoc reindex --rechunk` Behavior Changes

| Scenario | Current Behavior | New Behavior |
|----------|-----------------|--------------|
| All chunks within limit | Re-embed all | Skip rechunk, re-embed all (model may differ) |
| Mixed chunk sizes | Re-chunk all, re-embed all | Only re-chunk oversized; preserve embeddings for unchanged chunks |

### `mountCollection()` Behavior Changes

| Scenario | Current Behavior | New Behavior |
|----------|-----------------|--------------|
| No `skipSegmentIds` | Download + index all | Same (backward compatible) |
| With `skipSegmentIds` | N/A | Skip download + indexing for known segments |

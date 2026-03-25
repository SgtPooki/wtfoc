# Data Model: Theme Clustering

## Entities

### Clusterer (interface — `@wtfoc/common`)

Pluggable seam for clustering algorithms. The 8th pluggable interface alongside Embedder, VectorIndex, StorageBackend, SourceAdapter, ManifestStore, EdgeExtractor, and ChunkScorer.

### ClusterRequest

Input to the clusterer.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| chunkIds | string[] | yes | IDs of chunks to cluster |
| embeddings | Map<string, Float32Array> | yes | Chunk ID → embedding vector |
| existingState | ClusterState | no | Previous cluster state for incremental mode |
| options | ClusterOptions | no | Algorithm-specific options |

### ClusterOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| targetClusterCount | number | undefined | Optional hint for target cluster count |
| minClusterSize | number | 3 | Minimum members for a cluster to be retained |
| similarityThreshold | number | 0.85 | Cosine similarity threshold for assignment |
| mode | "batch" \| "incremental" | "incremental" | Full rebuild or assign-only |

### ClusterResult

Output from the clusterer.

| Field | Type | Description |
|-------|------|-------------|
| clusters | Cluster[] | Array of discovered clusters |
| unassigned | string[] | Chunk IDs that didn't fit any cluster |
| metadata | Record<string, unknown> | Optional algorithm-specific metadata |

### Cluster

| Field | Type | Description |
|-------|------|-------------|
| id | string | Stable cluster identifier |
| memberIds | string[] | Chunk IDs in this cluster |
| exemplarIds | string[] | Most representative chunk IDs (max 5) |
| confidence | number | 0-1 quality/cohesion score |
| metadata | Record<string, unknown> | Optional algorithm-specific data |

### ClusterState (persisted)

Mutable derived artifact at `~/.wtfoc/clusters/{collection}/{revision}/state.json`.

| Field | Type | Description |
|-------|------|-------------|
| collectionId | string | Collection this state belongs to |
| revisionId | string \| null | Collection revision at time of clustering |
| clusteredChunkIds | string[] | All chunk IDs that have been assigned |
| clusters | Cluster[] | Current cluster set |
| algorithm | string | Algorithm that produced this state |
| createdAt | string | ISO timestamp of initial clustering |
| updatedAt | string | ISO timestamp of last incremental update |

### ThemeCluster (output — derived from Cluster + collection data)

User-facing enriched cluster for CLI/API output. Not persisted — computed on the fly from ClusterState + segment data.

| Field | Type | Description |
|-------|------|-------------|
| rank | number | 1-based rank by size |
| size | number | Number of member chunks |
| label | string | Auto-generated heuristic label from top terms |
| topTerms | string[] | Most representative terms (extracted from exemplar text, stop-word filtered) |
| exemplars | ExemplarChunk[] | Representative chunks with content + source |
| sourceDistribution | Record<string, number> | sourceType → chunk count |
| signalAggregates | Record<string, number> | signalType → average score |
| dominantSignal | string \| null | Highest-scoring signal type |
| confidence | number | Cluster cohesion score |

### ExemplarChunk

| Field | Type | Description |
|-------|------|-------------|
| id | string | Chunk ID |
| content | string | Chunk content (or excerpt) |
| source | string | Source identifier |
| sourceType | string | Source type |
| sourceUrl | string \| undefined | URL back to original |

## Relationships

```
Collection (1) → ClusterState (1, mutable, separate store)
ClusterState (1) → Cluster (many)
Cluster (1) → Chunk (many, via memberIds)
Cluster (1) → ExemplarChunk (3-5, subset of members)
ThemeCluster = Cluster + enrichment from Segment data
```

## State Transitions

```
No cluster state exists
  → [wtfoc themes] → batch cluster → ClusterState created

ClusterState exists, collection unchanged
  → [wtfoc themes] → return cached results

ClusterState exists, new chunks ingested
  → [wtfoc themes] → incremental assign new chunks → ClusterState updated

Any state
  → [wtfoc themes --rebuild] → full batch recluster → ClusterState replaced
```

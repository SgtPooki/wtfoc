# Quickstart: Theme Clustering

## Usage

```bash
# Discover themes in a collection
wtfoc themes -c foc-ecosystem

# Filter by signal type
wtfoc themes -c foc-ecosystem --signal pain

# Force full rebuild
wtfoc themes -c foc-ecosystem --rebuild

# JSON output for programmatic use
wtfoc themes -c foc-ecosystem --json

# Hint at target cluster count
wtfoc themes -c foc-ecosystem --target-clusters 30
```

## How it works

1. Loads collection via `mountCollection()` (segments + embeddings + signal scores)
2. Checks for existing cluster state at `~/.wtfoc/clusters/{collection}/{revision}/`
3. If no state exists → batch clustering (greedy threshold-based, single pass)
4. If state exists → incremental assignment (new chunks assigned to existing clusters or form new ones)
5. Persists updated cluster state
6. Enriches clusters with exemplar chunks, labels (first meaningful words from exemplars, stop-word filtered), source distribution, signal aggregates
7. Outputs ranked clusters (largest first, top 20 displayed by default)

## Architecture

```
@wtfoc/common         → Clusterer interface + types (ClusterRequest, ClusterResult, etc.)
@wtfoc/search         → AnnClusterer implementation + cluster state persistence
@wtfoc/cli            → wtfoc themes command
apps/web/server       → /api/collections/:name/themes endpoint (future)
```

## Key files

```
packages/common/src/interfaces/clusterer.ts    # Clusterer interface
packages/search/src/clustering/index.ts        # Re-exports
packages/search/src/clustering/ann-clusterer.ts # Default implementation
packages/search/src/clustering/cluster-state.ts # State persistence
packages/search/src/clustering/labels.ts       # Cluster label extraction
packages/search/src/clustering/cosine.ts       # Optimized cosine similarity
packages/cli/src/commands/themes.ts            # CLI command
```

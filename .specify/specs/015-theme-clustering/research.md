# Research: Theme Clustering

## R1: ANN search implementation

**Decision**: Optimized brute-force cosine similarity in pure TypeScript.
**Rationale**: 26K-50K vectors at 384d is small enough for exact search. VP-trees degrade in high dimensions. LSH adds tuning complexity. Reuse the pattern from `InMemoryVectorIndex` but optimize for clustering: pre-normalize vectors once, use a top-k heap instead of full sort, avoid object cloning per comparison.
**Alternatives considered**: VP-tree (degrades at 384d), LSH (too complex for MVP), calling existing `InMemoryVectorIndex.search()` directly (too slow for clustering loops due to per-result cloning and full sort).

## R2: Incremental assignment algorithm

**Decision**: Top-12 nearest neighbor search with 2+ cluster member agreement.
**Rationale**: For each unclustered chunk, find top-12 nearest clustered chunks. Assign to a cluster only if: (1) nearest neighbor similarity >= 0.75, (2) the winning cluster has at least 2 members in the top-12, and (3) that cluster's summed similarity is >= 1.5x the runner-up. This prevents false assignments from local noise while being less brittle than "2 of top-5."
**Alternatives considered**: Top-5 with 2+ agreement (too brittle), single nearest neighbor (too greedy), full pairwise comparison (O(n^2), OOM risk).

## R3: Initial batch clustering

**Decision**: Greedy single-pass threshold-based clustering.
**Rationale**: Process chunks in stable randomized order. Compare each chunk against existing cluster centroids. If similarity >= 0.75, assign to nearest cluster. Otherwise, start a new cluster. Optional cleanup/reassignment pass afterward. This matches the incremental path, avoids guessing k, and won't OOM.
**Alternatives considered**: k-means (needs guessed k, fights threshold-driven model), hierarchical agglomerative (too expensive at 26K), similarity graph + connected components (O(n^2) graph construction).

## R4: Exemplar selection

**Decision**: 3 members closest to cluster centroid.
**Rationale**: Stable, cheap, and representative. Centroid is computed as the mean of member embeddings (maintained incrementally). Better than seed-based (arbitrary) or highest-average-similarity (O(n^2) per cluster).
**Alternatives considered**: Highest average intra-cluster similarity (too expensive), seed/first member (arbitrary), random sample (not representative).

## R5: Top terms extraction

**Decision**: TF-IDF scoring over cluster terms vs collection-wide document frequency.
**Rationale**: Terms frequent in this cluster but rare across the collection produce much better labels than raw frequency, which over-promotes generic vocabulary. Simple `tf * log(N / df)` score is sufficient for MVP.
**Alternatives considered**: Raw term frequency (promotes generic terms), first N words from exemplar (fragile), concatenate + deduplicate (no relevance weighting).

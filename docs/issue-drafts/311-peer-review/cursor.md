- **Single biggest risk:** optimizing a **single blended scalar on a tiny, static fixture** will produce policy overfitting (better leaderboard, worse real user outcomes), especially under coupled knobs (chunking/embedder/retrieval) and changing corpora.

- **1) Metric design**
  - Geo-mean(`portable_pass`, `overall_applicable_pass`) is directionally good (penalizes one-sided wins), but it **hides failure modes** in demo-critical/file-level/work-lineage.
  - Keep one headline, but make it **constrained optimization**: maximize headline **subject to** hard floors on demo-critical/file-level/work-lineage and min applicability.
  - Better scalar: `geo_mean(portable, corpus_specific, advisory)` with floor gates; current formula overweights whichever bucket has more applicable queries.
  - Cost-adjustment `pass_rate / (cost + time*ε)` is fragile (unit-sensitive, explodes near zero). Prefer **Pareto frontier** (quality, cost, latency) or `quality - λ*cost - μ*latency` with fixed λ/μ from product SLOs.

- **2) Overfitting / gaming risk**
  - Two-corpus guard is necessary but not sufficient; sweeper can game by improving “easy portable” while regressing synthesis faithfulness.
  - Easy exploit: tune top-K/diversity to increase pass-rate via broader retrieval while silently increasing hallucinated synthesis.
  - Missing strongest anti-gaming signal: **faithfulness/citation correctness** (answer claims must map to retrieved evidence spans) and **evidence-source diversity** checks.

- **3) Statistical validity**
  - 45 queries is too small for tight ranking; 1 flip ≈2.2% is large.
  - Bootstrap CI is fine, but use **paired bootstrap/permutation** on per-query outcomes between baseline and candidate.
  - Decision rule: only call “win” if `P(candidate > baseline) >= 0.95` **and** absolute lift >= practical threshold (e.g., 3–5%).
  - Yes, expand fixture before broad sweeps; prioritize adding hard negatives and near-duplicate traps.

- **4) Knob ordering**
  - Retrieval-first is right for cost/speed.
  - Start even narrower: reranker on/off, top-K, diversity, edge-weighting (no re-ingest).
  - Strong coupling exists: **chunker × embedder × retrieval**; independent one-axis sweeps will mislead after phase-1.
  - After phase-1, do factorial mini-grids on top 2–3 retrieval configs before touching embedder/chunker globally.

- **5) Pruning policy**
  - “regress > threshold” is too blunt.
  - Use **successive halving / Hyperband** style:
    - Stage A: cheap subset eval (portable + demo-critical).
    - Stage B: full 45-query eval for survivors.
    - Stage C: replicate run (different seed/order/cache-bust) for top-N.
  - Prune when candidate is **statistically dominated** (lower quality and no cost/latency advantage) or violates hard gates.
  - Neighbor proposal: local search around best configs, but enforce exploration quota (e.g., 20%) to avoid local maxima lock-in.

- **6) Missing axes / metrics**
  - **Latency percentiles** (p50/p95 end-to-end and stage-level).
  - **Retrieval recall@k / MRR** against gold evidence mappings (separate from final answer pass).
  - **Citation faithfulness / attribution precision**.
  - **Cross-source evidence diversity** (not just retrieved chunk diversity).
  - **Robustness**: prompt perturbation/paraphrase invariance.
  - **Stability**: run-to-run variance with same config.

- **7) Autoresearch parallels**
  - Karpathy/autoresearch framing is useful for loop mechanics, but you need eval-harness rigor from SWE-bench/OpenAI-evals style systems.
  - Steal: immutable run manifests, strict environment pinning, cache isolation, reproducible seeds, per-test artifact capture, and regression triage bundles.
  - Inspect-style traceability (per-query trace + judge inputs) is more valuable here than pure leaderboard automation.

- **8) Quiet failure modes**
  - Cross-variant cache contamination (retrieval/embedding cache reuse).
  - Hidden model drift despite nominal pin (provider-side revisions).
  - Fixture decay as corpus evolves; “gold” no longer representative.
  - Applicability drops misread as quality shifts.
  - Threshold floors suppressing exploration of configs that initially dip but unlock better optima.
  - Cost logging gaps causing biased selection toward unmeasured-expensive variants.

- **Concrete recommendations**
  - Treat headline score as **secondary**; primary is gated quality vector + significance.
  - Add per-run immutable config fingerprint + full provenance (model IDs, prompts, seeds, corpus digest, cache key namespace).
  - Introduce paired significance test + replicate policy before accepting winners.
  - Add faithfulness and latency as first-class axes before enabling unattended nightly “auto-promote” behavior.

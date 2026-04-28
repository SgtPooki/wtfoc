YOLO mode is enabled. All tool calls will be automatically approved.
YOLO mode is enabled. All tool calls will be automatically approved.
MCP issues detected. Run /mcp list for status.Skill conflict detected: "peer-review" from "/Users/sgtpooki/code/sgtpooki/homelab-system/wtfoc/.agents/skills/peer-review/SKILL.md" is overriding the same skill from "/Users/sgtpooki/.agents/skills/peer-review/SKILL.md".Concrete, opinionated review of the **wtfoc autoresearch loop** proposal:

### 1. Metric Design & Cost-Adjustment
*   **Geo-mean vs. Pareto:** Geo-mean is good for preventing "sacrificial" optimization (improving one at the total expense of the other), but with N=13 for `portable`, the metric is hyper-sensitive. A single query flip in the portable set moves the headline scalar by ~8%.
*   **Recommendation:** Use a **Pareto-front** approach for the leaderboard rather than a single scalar. If you must have one number, use a **Bayesian Expected Loss** or a weighted arithmetic mean with a "Minimum Floor" penalty (e.g., if any tier < floor, score = 0).
*   **Cost Sane?** The `pass_rate / (cost + time)` formulation is dangerous. It rewards "fast failures." Better: `Score - λ * log(Cost)` to penalize exponential cost increases while still valuing marginal gains.

### 2. Overfitting & Gaming Risk (The "Small-N" Problem)
*   **45 queries is a trap.** A sweeper will find "hallucination-positive" configs—where a model happens to guess the right answer for the wrong reasons because of a specific prompt shim.
*   **The Guard:** The two-corpus guard is necessary but insufficient.
*   **The Fix:** You need **Query Perturbation**. For each gold query, the loop should auto-generate 3-5 semantic variants (paraphrases). If a variant breaks the "win," the config is brittle/overfit.

### 3. Statistical Validity
*   **Bootstrap CI is mandatory.** With 45 queries, any "win" < 10% delta is likely noise.
*   **Protocol:** Don't just log the pass rate; log the **Variance** over 3 runs per variant (especially for high-temp extractors). If variance > gain, discard.

### 4. Knob Ordering & Coupling
*   **Coupling Alert:** **Axis 2 (Chunking) and Axis 1 (Embedder) are hard-coupled.** Changing chunk size invalidates previous embedder "wins."
*   **Phase 0:** Start with **Axis 4 (Retrieval)** and **Axis 3 (Edge Prompting)**. These are the "software" layers. Axes 1-2 are the "hardware" layers (expensive, foundational). Never sweep 1-2 until 3-4 are stabilized on a baseline.

### 5. Loop Pruning Policy
*   **Pruning Rule:** Use an **ε-Greedy Bandit** strategy rather than hard pruning. Pruning "regressions" early might kill a branch that would have succeeded with a better reranker (Axis 4). 
*   **Beam Search:** Keep a "Top 3" for each axis and branch neighbors from there.

### 6. Missing Axes
*   **Faithfulness/Hallucination:** A pass-rate doesn't detect if the answer is "Correct but for the wrong reason" (e.g., the model used its internal knowledge, not the RAG context). Track `citation_overlap`—did the model actually use the retrieved nodes?
*   **Latency p99:** In a decentralized tool, a 30-second "gold" answer is often worse than a 3-second "silver" answer.

### 7. Autoresearch Parallels
*   **Avoid Karpathy's simplicity.** This is more like **OpenAI's Evals** or **Inspect AI**. Karpathy's loop assumes the "ground truth" is code execution (pass/fail). RAG is "vibes-adjacent." 
*   **Steal:** "Model-graded evaluation" (using a stronger model like GPT-4o/Claude 3.5 Sonnet to grade the Haiku output) is more robust than simple string matching or binary pass/fail.

### 8. Failure Modes
*   **Cache Poisoning:** If variants share an embedding cache but change the chunking logic, you will get "ghost" results. Each variant MUST have a unique hash-based namespace for its vector index.
*   **Fixture Decay:** As the codebase evolves, "Gold" answers become "Stale" answers. The loop will start optimizing for the *past* state of the repo.

---

### 🚩 The Single Biggest Risk: **The "Phantoms of Quality"**
With a tiny fixture (45 queries) and a powerful sweeper, you will optimize for **prompt-specific luck**. You'll find a configuration that is 95% "accurate" on the fixture but 40% accurate on the first new question a user asks. 

**Critical Recommendation:** Do not start the loop until the fixture is at least **150+ queries**, or you implement **synthetic query expansion** (generating new "Silver" queries from the corpus on every sweep) to act as a validation set.

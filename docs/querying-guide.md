# Querying wtfoc efficiently

How to phrase questions so wtfoc surfaces the right evidence. Distilled from a few months of dogfooding gold-standard queries against real corpora — mostly learned the hard way.

## The two retrieval surfaces

- **`wtfoc query <text>`** — semantic top-K. Embed the query, rank chunks by cosine similarity, return the top 10. No edges. Fast. Use when you want the best-matching chunk and don't care how it connects to anything else.
- **`wtfoc trace <text>`** — semantic seeds, then walk explicit edges to reconstruct cross-source evidence chains. Slower. Use when you want the story, not just a chunk: code ↔ PR ↔ issue ↔ Slack-thread-that-started-it.

Most "why is my answer wrong" problems map to one of:
1. The query anchored in a source type that had no edges to the evidence you wanted.
2. The corpus genuinely does not contain the evidence you wanted.
3. The query words do not overlap with the words the content actually uses.

## Query phrasing rules of thumb

### 1. Use the corpus's nomenclature, not yours

If your team says "Filecoin Pay" but the corpus code/issues call it "filecoin-services" or "synapse-sdk payments," retrieval will miss. Run `wtfoc query <rough query>` once, inspect the top results' `source` paths, then rewrite your query using the exact repo/module names you see.

This is the single highest-leverage change you can make. Semantic similarity is not magic — the embedder matches tokens close to what it saw during training, and niche project vocabulary may not be token-close to its common synonym.

### 2. Anchor the query type explicitly

The persona classifier (`autoRoute`) picks source-type boosts from phrasing cues. If you want code:

- "How **does** the X work?" — triggers the *technical* persona, boosts code + markdown.
- "What **discussions** mention X?" — triggers *discussion*, boosts issues + PR comments + slack.
- "What **changed** in X?" — triggers *changes*, boosts PRs + issues.
- "What do the **docs** say about X?" — triggers *docs*, boosts doc-page + markdown.

Phrasing that doesn't match any persona gets the open-ended fallback with no boosts — which is fine for ambiguous queries but means you lose the type routing. Err on the side of one explicit intent word.

### 3. Be concrete about which artifact you want

"How do we handle errors" is vague. "Which error-handling middleware intercepts 500s in the HTTP server" is not — it names a module shape, a behavior, and a response code. Concrete queries hit concrete chunks.

Narrow queries that name a file or a symbol (`PieceCID validation in piece.ts`, `DataSetStatus enum values`) are especially strong because the chunk's `source` path often contains the literal term and it can win on both semantic and lexical grounds.

### 4. Expect trace to bridge, not create, evidence

Trace can only walk edges that exist. If no edge links a PR to its Slack conversation (because the PR body didn't reference the URL), no amount of tracing produces the bridge. If trace on your query reaches only one source type, either:

- The anchor chunk has no outgoing edges to the other type — the corpus is missing structural connective tissue. File an ingest issue.
- The anchor chunk has edges but confidence is below the trace's default threshold. Try `--max-hops 5` or `--mode analytical` for a wider walk.

### 5. Diversity-enforce when a single type dominates

Slack-heavy corpora consistently flood top-K with messages because short informal text embeds close to most queries. Our flagship dogfood runs with `--diversity-enforce` (reserves top-K slots per source type above a score floor; see #161). If you're building your own tooling on top of `query()` / `trace()`, pass `diversityEnforce: { minScoreRatio: 0.65 }` in the options to get the same behavior.

The score floor is the important knob: too low and you surface weak candidates just to hit the diversity target; too high and you revert to single-type dominance. 0.65 has worked well on our corpora but depends on the distribution.

## Gold-standard query design

If you're contributing queries to `packages/search/src/eval/gold-standard-queries.ts`:

### Requirements to meet

- **`requiredSourceTypes`** — list only types the corpus can actually produce via the query's natural anchor. Don't assert a type just because the corpus contains it somewhere; assert it because the trace-from-this-anchor reliably reaches it. Peer-reviewed principle: *encode structurally-supported expectations, not wishful topology*.
- **`expectedSourceSubstrings`** — match on `source` (repo path, document id), not on content. Content rarely contains the repo's own name; paths almost always do.
- **`collectionScopePattern`** — add this when the query probes artifacts native to one corpus family (e.g. `^(wtfoc-|default$)` for wtfoc-self internals). Queries outside their scope are marked skipped, not failed, keeping the applicable pass rate honest across corpora.

### Debugging a failing query

1. Run `wtfoc query "<text>"` with the same embedder config. Check the top 10 `sourceType` distribution. If your required types aren't there, the query phase is the bottleneck — rephrase or add boosts.
2. Run `wtfoc trace "<text>" --mode analytical --json` and look at `stats.sourceTypes`. Types reached via trace expand the top-K. If they still don't include what you need, the edge graph is the bottleneck.
3. Check `expectedSourceSubstrings` against the actual `source` values in the top-K. Substrings are case-insensitive `.includes()` on the source, not content. If your substring is a semantic concept ("payments") and the corpus path uses different language ("synapse-core/pay/deposit.ts"), the substring gate fails even though retrieval worked.
4. If the query genuinely cannot be answered by the corpus, tag it with `collectionScopePattern` that excludes this corpus. Do not rewrite the query to pass. *Teaching the eval harness to pass instead of improving retrieval* is how measurement instruments lose their value.

## Anti-patterns

### "Rephrase until it passes"

The temptation is real. Codex called it out: a query that passes only because we twiddled wording until one gateway-of-a-chunk surfaced is a fragile signal that will rot on the next re-ingest. If the answer is genuinely in the corpus, the query should find it through multiple reasonable phrasings. If it only works via one magic phrasing, the retrieval (or the corpus) is the real problem.

### "Lower the required types until it passes"

Valid in a few specific cases (corpus genuinely lacks a type, trace cannot structurally reach a type from this anchor). Invalid as a general technique — it softens the test at the moment you most want it to be loud.

### "Raise the threshold to match the current pass rate"

Thresholds exist to catch regressions. Raising them only when things are going well creates a ratchet that eventually locks you out of acceptable noise. Our flagship overall threshold stays at 80% while the current baseline is 85% — that's a healthy buffer, not a reason to tighten.

## The dogfood loop for your own corpus

If you're applying wtfoc to a new corpus (your own repos, your team's docs + Slack + issues):

1. Ingest. Run `wtfoc status` to confirm you have all the source types you expected.
2. Write 10–20 queries you actually want answered. Mix direct lookup, cross-source, and synthesis categories — don't just ask "find me X" twenty times.
3. Run `pnpm dogfood --collection <name> --stage quality-queries --diversity-enforce`. Capture the report.
4. For each failing query, pick one path: (a) rephrase using corpus vocabulary, (b) add a persona cue, (c) enable diversity if slack/doc-page is flooding, (d) admit the corpus can't answer this one and drop the query from your fixture.
5. Rerun. Track which changes actually moved numbers vs which were wishful thinking.

Expect the first pass to be ugly. Pass rates below 50% are normal until you've closed the gap between how you phrase questions and how the corpus actually talks about the same concepts.

## See also

- [`docs/evidence-layer.md`](evidence-layer.md) — what wtfoc is for and isn't
- [`docs/dogfood-cadence.md`](dogfood-cadence.md) — flagship regression gate
- [`packages/search/src/eval/gold-standard-queries.ts`](../packages/search/src/eval/gold-standard-queries.ts) — live fixture + schema
- [`packages/search/src/persona/classify-query.ts`](../packages/search/src/persona/classify-query.ts) — persona rules and source-type boosts

# Changelog

## [0.0.4](https://github.com/SgtPooki/wtfoc/compare/search-v0.0.3...search-v0.0.4) (2026-04-30)


### Features

* add multi-signal chunk scoring with heuristic scorer ([#61](https://github.com/SgtPooki/wtfoc/issues/61)) ([63d4523](https://github.com/SgtPooki/wtfoc/commit/63d4523502b49ebdc20ebdf626a108162b28965b))
* add semantic fallback for underrepresented source types in trace ([a55fc0b](https://github.com/SgtPooki/wtfoc/commit/a55fc0b6ecbb76cc5f2c55e527717b56959da9cf))
* add theme clustering with Clusterer interface and CLI command ([9a6a621](https://github.com/SgtPooki/wtfoc/commit/9a6a62150767efec4e09a9b07592853febb12f4e)), closes [#59](https://github.com/SgtPooki/wtfoc/issues/59)
* **cli:** LLM-powered theme labels, noise summary, config filtering ([#179](https://github.com/SgtPooki/wtfoc/issues/179)) ([354c565](https://github.com/SgtPooki/wtfoc/commit/354c56527b6f7f42c7942fb01dbcdc908e3d75a2))
* **dogfood:** per-source-type breakdown, overlay edges in search, gold standard queries ref [#247](https://github.com/SgtPooki/wtfoc/issues/247) ([c0d538e](https://github.com/SgtPooki/wtfoc/commit/c0d538eae8208d6541f89ed69a84a0cdd28d24c7))
* **dogfood:** thread --auto-route through search + quality-queries evaluators ref [#265](https://github.com/SgtPooki/wtfoc/issues/265) ([d3069f0](https://github.com/SgtPooki/wtfoc/commit/d3069f0bfe0d2045d2ed6f05f4708220b710c98e))
* **embedder:** configurable model profiles ([#170](https://github.com/SgtPooki/wtfoc/issues/170)) ([df9cce6](https://github.com/SgtPooki/wtfoc/commit/df9cce6649a77c5b26792f2e3b3a5901c06e6c1a))
* **eval:** autoresearch loop — instrumentation, sweep harness, first sweep findings (fixes [#311](https://github.com/SgtPooki/wtfoc/issues/311)) ([#317](https://github.com/SgtPooki/wtfoc/issues/317)) ([48a49a3](https://github.com/SgtPooki/wtfoc/commit/48a49a33bee56887f789f55e3122c6d34c96bb1d))
* **eval:** chainTemporalCoherence metric per edge type ([ba6283c](https://github.com/SgtPooki/wtfoc/commit/ba6283cdc7a0b7e8551dced4df7c06c65b87b97e))
* **eval:** file-level gold queries for dogfood ([#286](https://github.com/SgtPooki/wtfoc/issues/286)) ([7fb4a09](https://github.com/SgtPooki/wtfoc/commit/7fb4a09a8b0dbe456e48c94ad9bf7315532b2006))
* **eval:** lineage trace quality metrics for dogfood ([e96994c](https://github.com/SgtPooki/wtfoc/commit/e96994c7c2822bd7fe0a14ff1e5e5e7d54c88860)), closes [#217](https://github.com/SgtPooki/wtfoc/issues/217)
* **eval:** work-lineage gold queries for flagship demo (v1.2.0) ([d2db6b1](https://github.com/SgtPooki/wtfoc/commit/d2db6b1b72e770e5a060455d8959655f5bb804ab))
* holistic dogfood evaluation framework ([#206](https://github.com/SgtPooki/wtfoc/issues/206)) ([#213](https://github.com/SgtPooki/wtfoc/issues/213)) ([6901fd9](https://github.com/SgtPooki/wtfoc/commit/6901fd9a44f0b2f6ce2c570dbb3453a8cff93d3a))
* improve edge quality — fix prompt-validator mismatch and edge resolution ([#234](https://github.com/SgtPooki/wtfoc/issues/234), [#193](https://github.com/SgtPooki/wtfoc/issues/193)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* improve edge quality — fix prompt-validator mismatch and edge resolution ([#243](https://github.com/SgtPooki/wtfoc/issues/243)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* **ingest,trace:** TimestampKind provenance + kindPairs drill-down on coherence ([df85d06](https://github.com/SgtPooki/wtfoc/commit/df85d0620b7867dab55cfe69ac6044d1a58fe0dc))
* **ingest:** incremental ingest pipeline ([#102](https://github.com/SgtPooki/wtfoc/issues/102)) ([#152](https://github.com/SgtPooki/wtfoc/issues/152)) ([4620081](https://github.com/SgtPooki/wtfoc/commit/4620081c8c0df113b45659ee1fefe4243ff8f195))
* lineage-first trace output with timeline and agent conclusion ([#214](https://github.com/SgtPooki/wtfoc/issues/214)) ([3788100](https://github.com/SgtPooki/wtfoc/commit/3788100fcd0378cd4d0a88eb906d8876644260b1))
* model-aware chunk sizing for GitHub/Slack/Discord adapters ([#96](https://github.com/SgtPooki/wtfoc/issues/96)) ([f3204d0](https://github.com/SgtPooki/wtfoc/commit/f3204d0551ca161222d08815817fccdaff34a237))
* overlay edges pipeline — extract, materialize, promote ([#162](https://github.com/SgtPooki/wtfoc/issues/162)) ([475450c](https://github.com/SgtPooki/wtfoc/commit/475450c876691dfa17e20102ec16a63b73fb6252))
* pluggable vector backends with Qdrant support ([#106](https://github.com/SgtPooki/wtfoc/issues/106)) ([61a7ae5](https://github.com/SgtPooki/wtfoc/commit/61a7ae50173976da1c9b5b5308fdf53ba29c991c))
* **reranker:** native MPS-aware reranker harness, drop Docker (refs [#319](https://github.com/SgtPooki/wtfoc/issues/319)) ([#325](https://github.com/SgtPooki/wtfoc/issues/325)) ([71a995a](https://github.com/SgtPooki/wtfoc/commit/71a995a4056ba148446888c346d79ff9c055cf18))
* **search,cli:** lifecycle-aware query and trace filtering ([b68a3c9](https://github.com/SgtPooki/wtfoc/commit/b68a3c9014e978e307b49c3c64c8745a4f01c851))
* **search:** add retry, backoff, and rate-limit pacing to OpenAIEmbedder ([fb90488](https://github.com/SgtPooki/wtfoc/commit/fb904883c64cc7068cfb22cc54ab183c32c7efff))
* **search:** BgeReranker sidecar and client for BAAI/bge-reranker-v2-m3 ref [#218](https://github.com/SgtPooki/wtfoc/issues/218) ([963d26d](https://github.com/SgtPooki/wtfoc/commit/963d26dfc56935ebdb1c1689f3597c89a6e29717))
* **search:** chunkLevelBoosts on QueryOptions + TraceOptions ([#287](https://github.com/SgtPooki/wtfoc/issues/287)) ([3a47512](https://github.com/SgtPooki/wtfoc/commit/3a4751273152d37bc84467b1f9406506fa3aac84))
* **search:** cross-source insight detection for analytical trace mode ([#159](https://github.com/SgtPooki/wtfoc/issues/159)) ([5708c69](https://github.com/SgtPooki/wtfoc/commit/5708c69c16a1e806d5efce0f2a4634259a08e2f7))
* **search:** diagnostics for boost-based routing (telemetry) ref [#265](https://github.com/SgtPooki/wtfoc/issues/265) ([b6e3b9f](https://github.com/SgtPooki/wtfoc/commit/b6e3b9f76ac6752a21bae3768cc191d179ed6881))
* **search:** hybrid scoring — diversityEnforce uses retrievalScore (refs [#313](https://github.com/SgtPooki/wtfoc/issues/313)) ([#326](https://github.com/SgtPooki/wtfoc/issues/326)) ([07d50fb](https://github.com/SgtPooki/wtfoc/commit/07d50fba73860a8f0fa88a96a222c91ec2afe3f7))
* **search:** LlmReranker — OpenAI-compat reranker via Claude proxy ref [#218](https://github.com/SgtPooki/wtfoc/issues/218) ([bb4357b](https://github.com/SgtPooki/wtfoc/commit/bb4357b8e9ee56a575fbcb8801c0a72a27978b3f))
* **search:** opt-in persistent query-embedding cache (wtfoc-7npr, [#284](https://github.com/SgtPooki/wtfoc/issues/284)) ([456484d](https://github.com/SgtPooki/wtfoc/commit/456484dfd1de621773c6e9aee01f42d3fbb76a12))
* **search:** Qdrant CID collection garbage collection ([#130](https://github.com/SgtPooki/wtfoc/issues/130)) ([c7fb876](https://github.com/SgtPooki/wtfoc/commit/c7fb87638874e455ead627aa81b811fcf0b4006f))
* **search:** Qdrant stale vector reconciliation on manifest update ([#132](https://github.com/SgtPooki/wtfoc/issues/132)) ([6cd26a8](https://github.com/SgtPooki/wtfoc/commit/6cd26a8c2798a2778fab17d5c5925628cfc8e796))
* **search:** rule-based query persona classifier with --auto-route fixes [#259](https://github.com/SgtPooki/wtfoc/issues/259) ([c725b57](https://github.com/SgtPooki/wtfoc/commit/c725b57d2be74f3933da9d5847198a2b136a05d3))
* **search:** source-type diversity enforcement in query + trace ([#161](https://github.com/SgtPooki/wtfoc/issues/161)) ([66a150d](https://github.com/SgtPooki/wtfoc/commit/66a150d37eebc03d4389ad1a5207253053f537d1))
* **search:** source-type include/exclude filter on query fixes [#256](https://github.com/SgtPooki/wtfoc/issues/256) ([0a2bb5c](https://github.com/SgtPooki/wtfoc/commit/0a2bb5c13a58b143b91dd88e94326745e6ebf5ee))
* **search:** sourceTypeBoosts on trace + shrink persona weights per codex review ref [#265](https://github.com/SgtPooki/wtfoc/issues/265) ([f727f66](https://github.com/SgtPooki/wtfoc/commit/f727f66ad66b83bd1be72ee522fd84e952899df6))
* **search:** weighted source-type boosts for never-drop routing fixes [#265](https://github.com/SgtPooki/wtfoc/issues/265) ([0b90421](https://github.com/SgtPooki/wtfoc/commit/0b904218e79111ed60fdbc07de580c1a8c815625))
* **search:** WTFOC_QUERY_FILTER for fixture subset smokes (fixes [#320](https://github.com/SgtPooki/wtfoc/issues/320)) ([#324](https://github.com/SgtPooki/wtfoc/issues/324)) ([225eeaf](https://github.com/SgtPooki/wtfoc/commit/225eeaf0b206424cddd06e4b370da38e3745263c))
* temporal edge extractor, configurable trace limits, source filtering ([7849558](https://github.com/SgtPooki/wtfoc/commit/784955891f16dea8406359a5c8c8c76ca9f6ea1e)), closes [#182](https://github.com/SgtPooki/wtfoc/issues/182)
* **testing:** add e2e integration test package ([#127](https://github.com/SgtPooki/wtfoc/issues/127)) ([427f571](https://github.com/SgtPooki/wtfoc/commit/427f5715c792249f1649477cb3cd41ee40c0c1c9))
* **trace:** chronological hop projection + rename traversal monotonicity metric ([7da3542](https://github.com/SgtPooki/wtfoc/commit/7da35420807897d10c96c8f61bd65aaf7683cce5)), closes [#274](https://github.com/SgtPooki/wtfoc/issues/274)
* **trace:** walkDirection on TraceHop.connection; split coherence by direction ([13bc4d5](https://github.com/SgtPooki/wtfoc/commit/13bc4d5835ba8b0dc87e1e277af35d4f5f71da50))


### Bug Fixes

* address codex polish on [#261](https://github.com/SgtPooki/wtfoc/issues/261) bead ([07bcbe7](https://github.com/SgtPooki/wtfoc/commit/07bcbe725a1ac45ccede9627c76b370e27cc2401))
* apply biome formatting to unformatted files ([#184](https://github.com/SgtPooki/wtfoc/issues/184)) ([dfe4287](https://github.com/SgtPooki/wtfoc/commit/dfe42875ac368bbdf76813926bd2700043c07c9a))
* **dogfood:** check requiredSourceTypes against trace hops, fix gold queries ref [#247](https://github.com/SgtPooki/wtfoc/issues/247) ([6afc72c](https://github.com/SgtPooki/wtfoc/commit/6afc72c88a60d0d61bba5941e597a98b35f7b5eb))
* **dogfood:** load overlay edges in resolution evaluator fixes [#229](https://github.com/SgtPooki/wtfoc/issues/229) ([44ec418](https://github.com/SgtPooki/wtfoc/commit/44ec418792a5493a041df17ce6fea312a7da76fb))
* **eval:** address codex polish on coherence metric ([2f3c000](https://github.com/SgtPooki/wtfoc/commit/2f3c000cfb9ef726402dfa0f61f13119768001e0))
* **eval:** address codex review of lineage metrics ([e7967a7](https://github.com/SgtPooki/wtfoc/commit/e7967a7ea8939b5c0b66a17511c48d01b3c3a1d0))
* improve theme clustering labels and CLI output per Codex review ([7a2a284](https://github.com/SgtPooki/wtfoc/commit/7a2a284c9c656020753d6d1e8e7d84e58895c6e0))
* **ingest:** correct AstHeuristicChunker span metadata after trim and large-chunk splits fixes [#248](https://github.com/SgtPooki/wtfoc/issues/248) ([b7abec1](https://github.com/SgtPooki/wtfoc/commit/b7abec1fbd8deb9d9184518a85d7995a0189344a))
* log warning when OpenAI embedder truncates inputs ([28a0a6a](https://github.com/SgtPooki/wtfoc/commit/28a0a6a64ebda8b2cc578dec65bc16b476d72ecb))
* lower default maxInputChars to 4000 for 2048-token models ([c18977a](https://github.com/SgtPooki/wtfoc/commit/c18977ac2a0084c03dd339de9d9c849fb8017acb))
* promote biome warnings/infos to errors and fix all diagnostics ([734ab91](https://github.com/SgtPooki/wtfoc/commit/734ab91a31da5d238a3641bc77e41915881ce1a0))
* **search:** align dogfood eval fixtures with actual source types fixes [#255](https://github.com/SgtPooki/wtfoc/issues/255) ([681829f](https://github.com/SgtPooki/wtfoc/commit/681829f579584b2b4de18b94b2c131472fba2d6a))
* **search:** persona filter fetch-size + discussion regex for plural nouns ([dbbd0d1](https://github.com/SgtPooki/wtfoc/commit/dbbd0d1aca0532a98be4bfd4acb328c19cb1ec02))
* **search:** replace unpaired surrogates in Qdrant payloads ([ad26fcb](https://github.com/SgtPooki/wtfoc/commit/ad26fcb2f1bfa65a9abfac8e56b65c99bcc2c937)), closes [#183](https://github.com/SgtPooki/wtfoc/issues/183)
* **search:** rerank pool-preservation + 2K-char per-candidate context (refs [#313](https://github.com/SgtPooki/wtfoc/issues/313)) ([#323](https://github.com/SgtPooki/wtfoc/issues/323)) ([550eeb8](https://github.com/SgtPooki/wtfoc/commit/550eeb80a8185315c1c33a0b2aa97cc47e651d12))
* **search:** resolver correctness — strip org/repo prefix, normalize ./, add inScopeResolutionRate ref [#247](https://github.com/SgtPooki/wtfoc/issues/247) ([12f8d0e](https://github.com/SgtPooki/wtfoc/commit/12f8d0e957c6390f691b16909ec45c237932e4bf))
* **search:** sanitize Qdrant payload strings to prevent JSON parse errors ([ddea28b](https://github.com/SgtPooki/wtfoc/commit/ddea28b51cd0d229c5a325b1d610922547396201)), closes [#183](https://github.com/SgtPooki/wtfoc/issues/183)
* slim Docker image to 674MB, require explicit embedder config ([f2c88de](https://github.com/SgtPooki/wtfoc/commit/f2c88de512de13f284c31a9edbff7afd4c385c81))
* **trace:** include walkDirection in followEdges dedup key ([ff07390](https://github.com/SgtPooki/wtfoc/commit/ff0739017c78f95e25e23f5aa06fb44bf4191934))
* truncate inputs exceeding embedder context limit ([8ff50a2](https://github.com/SgtPooki/wtfoc/commit/8ff50a272fb6804edcfde13f416784e0f08b7390))


### Refactoring

* **runtime:** unify hydration, add cache freshness, document architecture ([#112](https://github.com/SgtPooki/wtfoc/issues/112)) ([f968fa6](https://github.com/SgtPooki/wtfoc/commit/f968fa65fb934b0a1ece693fa4c34ae9e4fcd491))
* split trace engine into indexing, resolution, and traversal modules ([#84](https://github.com/SgtPooki/wtfoc/issues/84)) ([c141949](https://github.com/SgtPooki/wtfoc/commit/c141949cf4eda98ff104cc6713c7f7b894dbf41d))
* test suite quality — deduplicate, strengthen mocks, add HTTP E2E ([#236](https://github.com/SgtPooki/wtfoc/issues/236)) ([92d1f42](https://github.com/SgtPooki/wtfoc/commit/92d1f42ee2d0cdae4cede8604d7ac297ab110ee0))


### Documentation

* add per-package READMEs and switch to npm Trusted Publishing ([428d530](https://github.com/SgtPooki/wtfoc/commit/428d530c875b6ce1c6cb4c70f5a6499c0ab9de74))
* rewrite READMEs for onboarding and marketing ([#100](https://github.com/SgtPooki/wtfoc/issues/100)) ([43aa9f3](https://github.com/SgtPooki/wtfoc/commit/43aa9f3ebc93ff2f18baf256273e0bb6cc9950fc))

## [0.0.3](https://github.com/SgtPooki/wtfoc/compare/search-v0.0.2...search-v0.0.3) (2026-03-24)


### Features

* case-insensitive source matching in edge resolution ([#72](https://github.com/SgtPooki/wtfoc/issues/72)) ([e54ccef](https://github.com/SgtPooki/wtfoc/commit/e54ccef6b1495565d1e4fb4f159133fc62ab40ed))
* improve multi-hop edge traversal with indexed lookups ([#68](https://github.com/SgtPooki/wtfoc/issues/68)) ([63fddf9](https://github.com/SgtPooki/wtfoc/commit/63fddf913f3ced1ae0885f7788842eb04291617a))
* resolve edges across renamed GitHub repos ([#72](https://github.com/SgtPooki/wtfoc/issues/72)) ([ffedddd](https://github.com/SgtPooki/wtfoc/commit/ffedddd58c3a83b0e7f8fcd3b471ab561e211db8))


### Refactoring

* extract shared edge resolution logic from trace engine ([a4655ba](https://github.com/SgtPooki/wtfoc/commit/a4655ba49d932bbf53367c616364a882c7d0c2d1))

## [0.0.2](https://github.com/SgtPooki/wtfoc/compare/search-v0.0.1...search-v0.0.2) (2026-03-23)


### Features

* centralize CURRENT_SCHEMA_VERSION + bidirectional edge traversal ([1bb671b](https://github.com/SgtPooki/wtfoc/commit/1bb671b6af021cbce7a8ebbfa4c2c817b0c566e4))
* collection provenance — identity, revisions, mount, diff ([#46](https://github.com/SgtPooki/wtfoc/issues/46)) ([b6d08a3](https://github.com/SgtPooki/wtfoc/commit/b6d08a3179b969840cdd19a2617d77dc7fd422a5))
* pluggable embedder with LM Studio support + auto-detect dimensions ([6f6e06c](https://github.com/SgtPooki/wtfoc/commit/6f6e06c3b4adfc6e75709f9164af238226c32492))
* **search:** add query function for simple semantic search ([0b6bd07](https://github.com/SgtPooki/wtfoc/commit/0b6bd07c1f582279efb501edef41943681272116))
* **search:** implement trace — the hero feature ([bdc5183](https://github.com/SgtPooki/wtfoc/commit/bdc51833a75c3a747ede5dac50ff5e0c06f7d1f6))
* **search:** scaffold @wtfoc/search package ([69c9e20](https://github.com/SgtPooki/wtfoc/commit/69c9e20e5b5f73f444891edfdc01c5e4e8c014c3))
* working ./wtfoc bin + all 10 FOC repos in demo + build fix ([be1fbf6](https://github.com/SgtPooki/wtfoc/commit/be1fbf683bb5b39571153b7f4c5bc27fe4df365c))


### Bug Fixes

* add content field to Segment chunks for display in results ([0612b26](https://github.com/SgtPooki/wtfoc/commit/0612b26d056a037c528409d4775ffb21d59c9291))
* **cli:** friendly dimension mismatch error + suppress dtype warning ([c6078ca](https://github.com/SgtPooki/wtfoc/commit/c6078ca655209291dd897fd210f270216d3ae7cb))
* enforce no non-null assertions + no double casts ([b478266](https://github.com/SgtPooki/wtfoc/commit/b478266deedc0c7cdd4f824479240bbf4336fbaa))
* standardize test scripts + fix agent-loop local-in-loop error ([d27f42f](https://github.com/SgtPooki/wtfoc/commit/d27f42f90eae036834c590da7396131d3f5eaae7))

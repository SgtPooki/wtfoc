# Changelog

## [0.0.4](https://github.com/SgtPooki/wtfoc/compare/cli-v0.0.3...cli-v0.0.4) (2026-04-30)


### Features

* add --rechunk flag to wtfoc reindex for re-chunking oversized content ([75eb8c4](https://github.com/SgtPooki/wtfoc/commit/75eb8c4a18a9af817b0f8cd3c4321624f49649ef))
* add --target flag to wtfoc reindex ([adc6fff](https://github.com/SgtPooki/wtfoc/commit/adc6fff49cce474ae8b042fe2a9f75441ecedf99))
* add /api/sources endpoint for collection source discovery ([d7f1b82](https://github.com/SgtPooki/wtfoc/commit/d7f1b828e2876eeb8266916dfc3912085a07a828))
* add collection descriptions for MCP agent discoverability ([#185](https://github.com/SgtPooki/wtfoc/issues/185)) ([3051dcd](https://github.com/SgtPooki/wtfoc/commit/3051dcde9c0ad724d90858ddcb51e6f62b3f3baf))
* add multi-signal chunk scoring with heuristic scorer ([#61](https://github.com/SgtPooki/wtfoc/issues/61)) ([63d4523](https://github.com/SgtPooki/wtfoc/commit/63d4523502b49ebdc20ebdf626a108162b28965b))
* add theme clustering with Clusterer interface and CLI command ([9a6a621](https://github.com/SgtPooki/wtfoc/commit/9a6a62150767efec4e09a9b07592853febb12f4e)), closes [#59](https://github.com/SgtPooki/wtfoc/issues/59)
* add web UI MVP with hosted multi-collection server ([#67](https://github.com/SgtPooki/wtfoc/issues/67)) ([38ee9ed](https://github.com/SgtPooki/wtfoc/commit/38ee9ed5a5b90362bbe3932d6e30200919704604))
* add wtfoc collections command and MCP tool ([#71](https://github.com/SgtPooki/wtfoc/issues/71)) ([95af0c5](https://github.com/SgtPooki/wtfoc/commit/95af0c577b47c6308f5c59f7fac83b8f70e89ec6))
* add wtfoc promote command to publish collections to FOC ([#60](https://github.com/SgtPooki/wtfoc/issues/60)) ([5240417](https://github.com/SgtPooki/wtfoc/commit/52404171d119ed89f7a6997e19acb71d7722c607))
* add wtfoc reindex command for re-embedding collections ([#40](https://github.com/SgtPooki/wtfoc/issues/40)) ([08c551f](https://github.com/SgtPooki/wtfoc/commit/08c551f780e93650619d380abb57379b7b41e5cc))
* **cli:** --verify-only pull, promote short-circuit, pull integrity checks (Session 3) ([eefcc6c](https://github.com/SgtPooki/wtfoc/commit/eefcc6c819c4616982fe8e480facda972e4e01b0)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* **cli+web:** promote and pull use self-containment publication index (Session 2) ([03a8fc8](https://github.com/SgtPooki/wtfoc/commit/03a8fc85837199b395da7fcfdfdb0601876a5e4a)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* **cli:** add wtfoc extract-edges command for incremental LLM extraction ([#145](https://github.com/SgtPooki/wtfoc/issues/145)) ([a8787a8](https://github.com/SgtPooki/wtfoc/commit/a8787a8f018d371c18480aa76d818a2e25ac8449))
* **cli:** add wtfoc extract-edges command for incremental LLM extraction ([#3](https://github.com/SgtPooki/wtfoc/issues/3)) ([a8787a8](https://github.com/SgtPooki/wtfoc/commit/a8787a8f018d371c18480aa76d818a2e25ac8449))
* **cli:** add wtfoc pull command to download collections from FOC/IPFS ([9e3423c](https://github.com/SgtPooki/wtfoc/commit/9e3423c23719842272339ef38b360e88c407b1c9))
* **cli:** document-level re-processing flags for targeted ingest ([928861f](https://github.com/SgtPooki/wtfoc/commit/928861f7078c7537106d2561ff45f05d8db97912))
* **cli:** LLM-powered theme labels, noise summary, config filtering ([#179](https://github.com/SgtPooki/wtfoc/issues/179)) ([354c565](https://github.com/SgtPooki/wtfoc/commit/354c56527b6f7f42c7942fb01dbcdc908e3d75a2))
* **cli:** version-aware ingest with document catalog and lifecycle management ([62f0380](https://github.com/SgtPooki/wtfoc/commit/62f0380187f0f4bb49fff2a0a1dbfc0b1327eece))
* **cli:** wtfoc verify-collection — remote CID-walking trust report ([#43](https://github.com/SgtPooki/wtfoc/issues/43)) ([1346b28](https://github.com/SgtPooki/wtfoc/commit/1346b2861743155e05eb7785125e92a0dfbd93f4))
* **cli:** wtfoc verify-trust — minimal local trust report ([#43](https://github.com/SgtPooki/wtfoc/issues/43)) ([126ef58](https://github.com/SgtPooki/wtfoc/commit/126ef58d521dfb0980fc3a81a46e0d7d45402c88))
* **collections:** populate segment repo/time metadata ([#126](https://github.com/SgtPooki/wtfoc/issues/126)) ([#164](https://github.com/SgtPooki/wtfoc/issues/164)) ([d5cee6c](https://github.com/SgtPooki/wtfoc/commit/d5cee6c4d19553a57f83c7132760ada04096b10f))
* **config:** .wtfoc.json project config file ([#151](https://github.com/SgtPooki/wtfoc/issues/151)) ([b72310c](https://github.com/SgtPooki/wtfoc/commit/b72310cd57ff508eb326a433d86f85ecd8e0f194))
* **config:** .wtfocignore support and expanded default exclusions ([#156](https://github.com/SgtPooki/wtfoc/issues/156)) ([1626300](https://github.com/SgtPooki/wtfoc/commit/1626300f4e92e6a001e1c504457fbdd9fba15e91))
* derived layer compaction + temporal-semantic edges + AST-heuristic chunking ([#205](https://github.com/SgtPooki/wtfoc/issues/205)) ([16da274](https://github.com/SgtPooki/wtfoc/commit/16da2742430e76cae11b0653cd849112169820ac))
* **embedder:** configurable model profiles ([#170](https://github.com/SgtPooki/wtfoc/issues/170)) ([df9cce6](https://github.com/SgtPooki/wtfoc/commit/df9cce6649a77c5b26792f2e3b3a5901c06e6c1a))
* improve edge quality — fix prompt-validator mismatch and edge resolution ([#234](https://github.com/SgtPooki/wtfoc/issues/234), [#193](https://github.com/SgtPooki/wtfoc/issues/193)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* improve edge quality — fix prompt-validator mismatch and edge resolution ([#243](https://github.com/SgtPooki/wtfoc/issues/243)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* **ingest,cli:** derived edge layers as immutable artifacts ([28ec3d7](https://github.com/SgtPooki/wtfoc/commit/28ec3d7af78864ce553b30c91ba0e9552255a78e))
* **ingest:** AST-aware code chunker with sidecar integration (Session 1) ([20a7be2](https://github.com/SgtPooki/wtfoc/commit/20a7be274f9e2ee16fb4fe36fe54febf4ae6f047)), closes [#220](https://github.com/SgtPooki/wtfoc/issues/220)
* **ingest:** async EdgeExtractor pipeline with composite + heuristic extractors ([#133](https://github.com/SgtPooki/wtfoc/issues/133)) ([03946c3](https://github.com/SgtPooki/wtfoc/commit/03946c3fad1c6a16cdac9b8fb616adf3cf61dddf))
* **ingest:** code edge extractor with oxc-parser + multi-language support ([#136](https://github.com/SgtPooki/wtfoc/issues/136)) ([e64c44e](https://github.com/SgtPooki/wtfoc/commit/e64c44eec0392918fb2385638c9274f184f6c0e8))
* **ingest:** cross-collection source fetch deduplication ([#224](https://github.com/SgtPooki/wtfoc/issues/224)) ([e557518](https://github.com/SgtPooki/wtfoc/commit/e5575187bc2e8e19a2384644dd67a48cc40c9686))
* **ingest:** default donor reuse to raw-archive-only; opt-in for chunk dedup ([6072f83](https://github.com/SgtPooki/wtfoc/commit/6072f83e7cd1e7ed7bbaee1ccb9abf630e0378c4))
* **ingest:** git-diff based incremental repo ingest ([aaaefca](https://github.com/SgtPooki/wtfoc/commit/aaaefca2d32434d743df3a86ac46c4cbde48bb86)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **ingest:** incremental ingest pipeline ([#102](https://github.com/SgtPooki/wtfoc/issues/102)) ([#152](https://github.com/SgtPooki/wtfoc/issues/152)) ([4620081](https://github.com/SgtPooki/wtfoc/commit/4620081c8c0df113b45659ee1fefe4243ff8f195))
* **ingest:** LLM edge extractor with source-agnostic prompt ([#138](https://github.com/SgtPooki/wtfoc/issues/138)) ([55fa564](https://github.com/SgtPooki/wtfoc/commit/55fa564e0f6697ae7cf4ee006adffb3f7da445c9))
* **ingest:** raw source archive — store originals before chunking ([82a97f6](https://github.com/SgtPooki/wtfoc/commit/82a97f6273a28064d22245ee9928802618eedffd))
* **ingest:** reingest --replay-raw routes archived raw content through current chunkers ([dfcecde](https://github.com/SgtPooki/wtfoc/commit/dfcecde7635cdb08062e5a1d17b70b616533f9c1))
* **ingest:** structural extractor synthesizes contains edges summary→symbol ([#285](https://github.com/SgtPooki/wtfoc/issues/285)) ([d99c1d1](https://github.com/SgtPooki/wtfoc/commit/d99c1d180478f0dd9f81fc3317310c7df861da97))
* **ingest:** unified extractor API for post-ingest edge overlays fixes [#215](https://github.com/SgtPooki/wtfoc/issues/215) ([3546895](https://github.com/SgtPooki/wtfoc/commit/3546895d0d631b4f6a3a31a7f190f5ee8e04bcca))
* **ingest:** website adapter --deny-path pattern filter ref [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([d26b17e](https://github.com/SgtPooki/wtfoc/commit/d26b17e10af12b6042070f2ee91453c85897016f))
* **ingest:** website crawler depth & page controls ([#165](https://github.com/SgtPooki/wtfoc/issues/165)) ([21c237f](https://github.com/SgtPooki/wtfoc/commit/21c237f1414a14b561119144a5ba332394a524b0))
* **ingest:** wire AST chunker into ingest + reingest ([#220](https://github.com/SgtPooki/wtfoc/issues/220) Session 2) ([de75fae](https://github.com/SgtPooki/wtfoc/commit/de75fae9f0eea20b3b4873d26e7818f4f8df8154))
* lineage-first trace output with timeline and agent conclusion ([#214](https://github.com/SgtPooki/wtfoc/issues/214)) ([3788100](https://github.com/SgtPooki/wtfoc/commit/3788100fcd0378cd4d0a88eb906d8876644260b1))
* model-aware chunk sizing for GitHub/Slack/Discord adapters ([#96](https://github.com/SgtPooki/wtfoc/issues/96)) ([f3204d0](https://github.com/SgtPooki/wtfoc/commit/f3204d0551ca161222d08815817fccdaff34a237))
* overlay edges pipeline — extract, materialize, promote ([#162](https://github.com/SgtPooki/wtfoc/issues/162)) ([475450c](https://github.com/SgtPooki/wtfoc/commit/475450c876691dfa17e20102ec16a63b73fb6252))
* pluggable vector backends with Qdrant support ([#106](https://github.com/SgtPooki/wtfoc/issues/106)) ([61a7ae5](https://github.com/SgtPooki/wtfoc/commit/61a7ae50173976da1c9b5b5308fdf53ba29c991c))
* **promote:** upload manifest to Filecoin and output shareable CID ([8b548a6](https://github.com/SgtPooki/wtfoc/commit/8b548a634070fcfea899f59994edc1f9f1b4ed7a)), closes [#94](https://github.com/SgtPooki/wtfoc/issues/94)
* **search,cli:** lifecycle-aware query and trace filtering ([b68a3c9](https://github.com/SgtPooki/wtfoc/commit/b68a3c9014e978e307b49c3c64c8745a4f01c851))
* **search:** add retry, backoff, and rate-limit pacing to OpenAIEmbedder ([fb90488](https://github.com/SgtPooki/wtfoc/commit/fb904883c64cc7068cfb22cc54ab183c32c7efff))
* **search:** cross-source insight detection for analytical trace mode ([#159](https://github.com/SgtPooki/wtfoc/issues/159)) ([5708c69](https://github.com/SgtPooki/wtfoc/commit/5708c69c16a1e806d5efce0f2a4634259a08e2f7))
* **search:** opt-in persistent query-embedding cache (wtfoc-7npr, [#284](https://github.com/SgtPooki/wtfoc/issues/284)) ([456484d](https://github.com/SgtPooki/wtfoc/commit/456484dfd1de621773c6e9aee01f42d3fbb76a12))
* **search:** rule-based query persona classifier with --auto-route fixes [#259](https://github.com/SgtPooki/wtfoc/issues/259) ([c725b57](https://github.com/SgtPooki/wtfoc/commit/c725b57d2be74f3933da9d5847198a2b136a05d3))
* **search:** source-type include/exclude filter on query fixes [#256](https://github.com/SgtPooki/wtfoc/issues/256) ([0a2bb5c](https://github.com/SgtPooki/wtfoc/commit/0a2bb5c13a58b143b91dd88e94326745e6ebf5ee))
* **search:** weighted source-type boosts for never-drop routing fixes [#265](https://github.com/SgtPooki/wtfoc/issues/265) ([0b90421](https://github.com/SgtPooki/wtfoc/commit/0b904218e79111ed60fdbc07de580c1a8c815625))
* **store+cli:** collection self-containment foundation (Session 1) ([de5a772](https://github.com/SgtPooki/wtfoc/commit/de5a772301125e38773a4b1aa81225d066936eec)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* temporal edge extractor, configurable trace limits, source filtering ([7849558](https://github.com/SgtPooki/wtfoc/commit/784955891f16dea8406359a5c8c8c76ca9f6ea1e)), closes [#182](https://github.com/SgtPooki/wtfoc/issues/182)
* **trace:** chronological hop projection + rename traversal monotonicity metric ([7da3542](https://github.com/SgtPooki/wtfoc/commit/7da35420807897d10c96c8f61bd65aaf7683cce5)), closes [#274](https://github.com/SgtPooki/wtfoc/issues/274)
* tree-sitter parser sidecar for polyglot code analysis ([#181](https://github.com/SgtPooki/wtfoc/issues/181)) ([0b8e0cc](https://github.com/SgtPooki/wtfoc/commit/0b8e0cc189a751831f36e097f84add0e39d20242))


### Bug Fixes

* apply biome formatting to unformatted files ([#184](https://github.com/SgtPooki/wtfoc/issues/184)) ([dfe4287](https://github.com/SgtPooki/wtfoc/commit/dfe42875ac368bbdf76813926bd2700043c07c9a))
* **cli+web:** address codex review of Session 2 before merging to main ([0bac1f6](https://github.com/SgtPooki/wtfoc/commit/0bac1f61ca4066c39f5b55bcf96d517a32b75500)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* **cli:** add --embedder flags to themes command ([#191](https://github.com/SgtPooki/wtfoc/issues/191)) ([3def89c](https://github.com/SgtPooki/wtfoc/commit/3def89cd935ecbddb555df666e6d5526f21d0005))
* **cli:** add --embedder flags to themes command ([#210](https://github.com/SgtPooki/wtfoc/issues/210)) ([3def89c](https://github.com/SgtPooki/wtfoc/commit/3def89cd935ecbddb555df666e6d5526f21d0005))
* **cli:** address codex polish on Session 2 wiring ([d440e85](https://github.com/SgtPooki/wtfoc/commit/d440e854f8132441fbbe5f0a051c78d78f26e77f))
* **cli:** address codex review of Session 3 before merging to main ([39044ef](https://github.com/SgtPooki/wtfoc/commit/39044ef26a7036346ac0950036544da738ddf850)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* **cli:** filter placeholder repo names and file-path false positives from suggest-sources fixes [#192](https://github.com/SgtPooki/wtfoc/issues/192) ([ad19141](https://github.com/SgtPooki/wtfoc/commit/ad19141473638509c736c791570d6e9dd0f3fbf2))
* **cli:** preserve metadata fields in reingest ([#226](https://github.com/SgtPooki/wtfoc/issues/226)) ([#230](https://github.com/SgtPooki/wtfoc/issues/230)) ([1839234](https://github.com/SgtPooki/wtfoc/commit/183923451d2d3b8d46ae7130d7cbb72a9fd1e591))
* **cli:** suppress progress output when --json flag is passed ([#208](https://github.com/SgtPooki/wtfoc/issues/208)) ([fd992e8](https://github.com/SgtPooki/wtfoc/commit/fd992e864025cdfddcfca976aef219aa214fc3d2))
* **cli:** use helper functions for extraction file paths ([#175](https://github.com/SgtPooki/wtfoc/issues/175)) ([df1b22a](https://github.com/SgtPooki/wtfoc/commit/df1b22a5bd55326cba20116cafe16b0f9bdc0b47)), closes [#148](https://github.com/SgtPooki/wtfoc/issues/148)
* collection name validation and sidecar file filtering ([#209](https://github.com/SgtPooki/wtfoc/issues/209)) ([658b711](https://github.com/SgtPooki/wtfoc/commit/658b7117fe8d3b1e39b36f982012a4202145fe38))
* **embedder:** don't route profile-only config to API embedder path ([#174](https://github.com/SgtPooki/wtfoc/issues/174)) ([b81a5b1](https://github.com/SgtPooki/wtfoc/commit/b81a5b1db7d4b947cd024b100b3daf7339099708)), closes [#172](https://github.com/SgtPooki/wtfoc/issues/172)
* format promote.ts and cid-reader.ts for biome ([4e9942c](https://github.com/SgtPooki/wtfoc/commit/4e9942cc861546c77a02c7ff3311d0887d4b2e12))
* improve theme clustering labels and CLI output per Codex review ([7a2a284](https://github.com/SgtPooki/wtfoc/commit/7a2a284c9c656020753d6d1e8e7d84e58895c6e0))
* **ingest:** 4 correctness bugs from Codex comprehensive review ([ef28a31](https://github.com/SgtPooki/wtfoc/commit/ef28a31a5973342a45d669f9745834d9b9030547)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **ingest:** address 5 bugs from Codex peer review ([307cad5](https://github.com/SgtPooki/wtfoc/commit/307cad529d5be10191096550ce3d0acb96c9921b)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **ingest:** address Codex follow-up on bug fixes ([ee18820](https://github.com/SgtPooki/wtfoc/commit/ee188207d233583bbb53229113d4c1681655304b))
* **ingest:** address codex review of AstChunker Session 1 ([c07b96f](https://github.com/SgtPooki/wtfoc/commit/c07b96f7f25f132b38f1501bf4f34bc1ba14d51b))
* **ingest:** lint fixes for biome check compliance ([3c71903](https://github.com/SgtPooki/wtfoc/commit/3c71903b7bfcc4ac79b973ea662a03301363fb6f))
* **ingest:** prompt token overhead + flat status path ([#146](https://github.com/SgtPooki/wtfoc/issues/146), [#148](https://github.com/SgtPooki/wtfoc/issues/148)) ([#171](https://github.com/SgtPooki/wtfoc/issues/171)) ([3967c1c](https://github.com/SgtPooki/wtfoc/commit/3967c1c0b168055ec10b2b0e01f1c78070a55efa))
* probe embedder dimensions before reindex logging ([74118b8](https://github.com/SgtPooki/wtfoc/commit/74118b8f3d009e1ebc0e48c9527903ec4f202f8c))
* **store:** per-download timeout + gateway fallback on helia hang ([#43](https://github.com/SgtPooki/wtfoc/issues/43)) ([2fe2a14](https://github.com/SgtPooki/wtfoc/commit/2fe2a14ff8f7d030c7ae04dbd20a52de76716716))
* **store:** release helia on CidReadableStorage.close() + plumb through ([f09a59d](https://github.com/SgtPooki/wtfoc/commit/f09a59d5eed84ad5b90ab1cf27ad86e086f8855b))
* **store:** use bare CIDs for IPNI indexing, single-CAR promote flow ([#147](https://github.com/SgtPooki/wtfoc/issues/147)) ([0798030](https://github.com/SgtPooki/wtfoc/commit/0798030a152854e359b3b7c1943b3d3402f35058))
* write manifest after each reindex batch for crash resilience ([b743bcd](https://github.com/SgtPooki/wtfoc/commit/b743bcdee3b19b31279bf6839dbfed65ee583830))


### Performance

* **cli:** catalog-based dedup avoids segment downloads on re-ingest ([aea90c9](https://github.com/SgtPooki/wtfoc/commit/aea90c937d2c8fd2c0986e4312f6b7618e1421b1))


### Refactoring

* break cli.ts into SOLID command modules ([#81](https://github.com/SgtPooki/wtfoc/issues/81)) ([dfb6468](https://github.com/SgtPooki/wtfoc/commit/dfb6468159ded5ed625a9e5fd208252b4007fed6))
* extract storedChunkToSegmentChunk() shared helper ([#233](https://github.com/SgtPooki/wtfoc/issues/233)) ([#238](https://github.com/SgtPooki/wtfoc/issues/238)) ([0f5fb29](https://github.com/SgtPooki/wtfoc/commit/0f5fb29b0752b8c0066e613d757d69172f04a70d))
* **ingest:** decouple ingest into composable pipeline stages ([#241](https://github.com/SgtPooki/wtfoc/issues/241)) ([f2db617](https://github.com/SgtPooki/wtfoc/commit/f2db6176e7def0d3942623ef588615d3d1666f59)), closes [#215](https://github.com/SgtPooki/wtfoc/issues/215)
* **runtime:** unify hydration, add cache freshness, document architecture ([#112](https://github.com/SgtPooki/wtfoc/issues/112)) ([f968fa6](https://github.com/SgtPooki/wtfoc/commit/f968fa65fb934b0a1ece693fa4c34ae9e4fcd491))
* **store:** split schema validators by domain ([#91](https://github.com/SgtPooki/wtfoc/issues/91)) ([3a7dc0b](https://github.com/SgtPooki/wtfoc/commit/3a7dc0bb5c25a09ce341973f07b3c99ab88934b8))
* test suite quality — deduplicate, strengthen mocks, add HTTP E2E ([#236](https://github.com/SgtPooki/wtfoc/issues/236)) ([92d1f42](https://github.com/SgtPooki/wtfoc/commit/92d1f42ee2d0cdae4cede8604d7ac297ab110ee0))


### Documentation

* add per-package READMEs and switch to npm Trusted Publishing ([428d530](https://github.com/SgtPooki/wtfoc/commit/428d530c875b6ce1c6cb4c70f5a6499c0ab9de74))
* rewrite READMEs for onboarding and marketing ([#100](https://github.com/SgtPooki/wtfoc/issues/100)) ([43aa9f3](https://github.com/SgtPooki/wtfoc/commit/43aa9f3ebc93ff2f18baf256273e0bb6cc9950fc))

## [0.0.3](https://github.com/SgtPooki/wtfoc/compare/cli-v0.0.2...cli-v0.0.3) (2026-03-24)


### Features

* add suggest-sources command for discovering ingestable references ([#73](https://github.com/SgtPooki/wtfoc/issues/73)) ([a80a535](https://github.com/SgtPooki/wtfoc/commit/a80a53529d257aab663ec781ad934a3f1a02989b))
* add unresolved-edges command for edge coverage monitoring ([#73](https://github.com/SgtPooki/wtfoc/issues/73)) ([71b31ae](https://github.com/SgtPooki/wtfoc/commit/71b31ae68c25b71fd82c9927cb44f5db9872e84a))
* add wtfoc npm package alias and provenance publishing ([59b8723](https://github.com/SgtPooki/wtfoc/commit/59b87230a13d15f4f64cbdc7edc6c4542e1a93d4))
* add wtfoc serve command with web UI ([#67](https://github.com/SgtPooki/wtfoc/issues/67)) ([8e79511](https://github.com/SgtPooki/wtfoc/commit/8e795115e8ea2679ea645cb62aa4b0373f1c125d))
* **cli:** resumable ingest with chunk dedup ([e5a0460](https://github.com/SgtPooki/wtfoc/commit/e5a04607e5a2a2d355143e188393d491872132ed))
* **cli:** wire GitHub adapter + real data demo script ([#52](https://github.com/SgtPooki/wtfoc/issues/52)) ([800f552](https://github.com/SgtPooki/wtfoc/commit/800f552e55a82c4ec59792285d208a692bba0a35))
* improve multi-hop edge traversal with indexed lookups ([#68](https://github.com/SgtPooki/wtfoc/issues/68)) ([63fddf9](https://github.com/SgtPooki/wtfoc/commit/63fddf913f3ced1ae0885f7788842eb04291617a))
* resolve edges across renamed GitHub repos ([#72](https://github.com/SgtPooki/wtfoc/issues/72)) ([ffedddd](https://github.com/SgtPooki/wtfoc/commit/ffedddd58c3a83b0e7f8fcd3b471ab561e211db8))


### Bug Fixes

* **cli:** batch ingest pipeline to prevent OOM on large repos ([6d2f497](https://github.com/SgtPooki/wtfoc/commit/6d2f497f7d752c7d6de7515fb5dda23ed36c7aa9))


### Refactoring

* **cli:** replace if/else ingest chain with pluggable adapter registry ([#53](https://github.com/SgtPooki/wtfoc/issues/53)) ([4abec80](https://github.com/SgtPooki/wtfoc/commit/4abec8079ebdd8f4b52c7196477274d817f15de3))
* extract shared edge resolution logic from trace engine ([a4655ba](https://github.com/SgtPooki/wtfoc/commit/a4655ba49d932bbf53367c616364a882c7d0c2d1))

## [0.0.2](https://github.com/SgtPooki/wtfoc/compare/cli-v0.0.1...cli-v0.0.2) (2026-03-23)


### Features

* CAR bundle uploads — one ingest, one PieceCID ([#45](https://github.com/SgtPooki/wtfoc/issues/45)) ([6aa58ef](https://github.com/SgtPooki/wtfoc/commit/6aa58efc74db8f1302e1703c21bab86da1751b5f)), closes [#41](https://github.com/SgtPooki/wtfoc/issues/41)
* centralize CURRENT_SCHEMA_VERSION + bidirectional edge traversal ([1bb671b](https://github.com/SgtPooki/wtfoc/commit/1bb671b6af021cbce7a8ebbfa4c2c817b0c566e4))
* **cli:** add ollama embedder shortcut + filecoin-pay repos to demo ([723c7cb](https://github.com/SgtPooki/wtfoc/commit/723c7cbca70c04063cc55e97193df33027a912a2))
* **cli:** detect embedding model mismatch on ingest ([829981c](https://github.com/SgtPooki/wtfoc/commit/829981cf3e2eb955145a876c33caf43bac38cd32))
* **cli:** pluggable embedder via --embedder flag (LM Studio support) ([844a56e](https://github.com/SgtPooki/wtfoc/commit/844a56e9043f84b65dd5b811f60909fe0749a5ab))
* **cli:** scaffold @wtfoc/cli package ([1222347](https://github.com/SgtPooki/wtfoc/commit/12223475f8723879a68cd5a8d5d02abe61622514))
* **cli:** working CLI with init, ingest, trace, query, status, verify ([c5b80e9](https://github.com/SgtPooki/wtfoc/commit/c5b80e91f5bf4ba278d9e44d14fc5c406d665b5d))
* collection provenance — identity, revisions, mount, diff ([#46](https://github.com/SgtPooki/wtfoc/issues/46)) ([b6d08a3](https://github.com/SgtPooki/wtfoc/commit/b6d08a3179b969840cdd19a2617d77dc7fd422a5))
* demo script + embedder quality warning + Ollama support prep ([e928666](https://github.com/SgtPooki/wtfoc/commit/e928666aba75fae6bb46bb5b328acad3057987da))
* global --storage flag + FocStorageBackend build fixes ([56dac45](https://github.com/SgtPooki/wtfoc/commit/56dac45694f8a350f8edbeee1c7e881ec2bb7155))
* pluggable embedder with LM Studio support + auto-detect dimensions ([6f6e06c](https://github.com/SgtPooki/wtfoc/commit/6f6e06c3b4adfc6e75709f9164af238226c32492))


### Bug Fixes

* add content field to Segment chunks for display in results ([0612b26](https://github.com/SgtPooki/wtfoc/commit/0612b26d056a037c528409d4775ffb21d59c9291))
* **cli:** friendly dimension mismatch error + suppress dtype warning ([c6078ca](https://github.com/SgtPooki/wtfoc/commit/c6078ca655209291dd897fd210f270216d3ae7cb))
* enforce no non-null assertions + no double casts ([b478266](https://github.com/SgtPooki/wtfoc/commit/b478266deedc0c7cdd4f824479240bbf4336fbaa))
* removed unsafe type casts, proper option extraction from config. ([c5b80e9](https://github.com/SgtPooki/wtfoc/commit/c5b80e91f5bf4ba278d9e44d14fc5c406d665b5d))
* standardize test scripts + fix agent-loop local-in-loop error ([d27f42f](https://github.com/SgtPooki/wtfoc/commit/d27f42f90eae036834c590da7396131d3f5eaae7))


### Refactoring

* **cli:** model-centric embedder flags instead of server-centric ([cad452e](https://github.com/SgtPooki/wtfoc/commit/cad452e04aa4e3070e17ac58ead77c8fd1abbc90))
* **common:** type-safe SourceAdapter with generic config + parseConfig ([7a92979](https://github.com/SgtPooki/wtfoc/commit/7a929798eed5a94198392075e8d276a8d9ed2034))

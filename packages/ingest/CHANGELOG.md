# Changelog

## [0.0.4](https://github.com/SgtPooki/wtfoc/compare/ingest-v0.0.3...ingest-v0.0.4) (2026-04-30)


### Features

* add Hacker News adapter for community signal ingestion ([#65](https://github.com/SgtPooki/wtfoc/issues/65)) ([3594930](https://github.com/SgtPooki/wtfoc/commit/35949305af8c11e34cf1e768484ca7116f9821be))
* add multi-signal chunk scoring with heuristic scorer ([#61](https://github.com/SgtPooki/wtfoc/issues/61)) ([63d4523](https://github.com/SgtPooki/wtfoc/commit/63d4523502b49ebdc20ebdf626a108162b28965b))
* add web UI MVP with hosted multi-collection server ([#67](https://github.com/SgtPooki/wtfoc/issues/67)) ([38ee9ed](https://github.com/SgtPooki/wtfoc/commit/38ee9ed5a5b90362bbe3932d6e30200919704604))
* **cli:** --verify-only pull, promote short-circuit, pull integrity checks (Session 3) ([eefcc6c](https://github.com/SgtPooki/wtfoc/commit/eefcc6c819c4616982fe8e480facda972e4e01b0)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* **cli+web:** promote and pull use self-containment publication index (Session 2) ([03a8fc8](https://github.com/SgtPooki/wtfoc/commit/03a8fc85837199b395da7fcfdfdb0601876a5e4a)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* **cli:** add wtfoc extract-edges command for incremental LLM extraction ([#145](https://github.com/SgtPooki/wtfoc/issues/145)) ([a8787a8](https://github.com/SgtPooki/wtfoc/commit/a8787a8f018d371c18480aa76d818a2e25ac8449))
* **cli:** add wtfoc extract-edges command for incremental LLM extraction ([#3](https://github.com/SgtPooki/wtfoc/issues/3)) ([a8787a8](https://github.com/SgtPooki/wtfoc/commit/a8787a8f018d371c18480aa76d818a2e25ac8449))
* **collections:** populate segment repo/time metadata ([#126](https://github.com/SgtPooki/wtfoc/issues/126)) ([#164](https://github.com/SgtPooki/wtfoc/issues/164)) ([d5cee6c](https://github.com/SgtPooki/wtfoc/commit/d5cee6c4d19553a57f83c7132760ada04096b10f))
* **common,ingest:** add document identity model and version-aware chunk IDs ([0a95ac8](https://github.com/SgtPooki/wtfoc/commit/0a95ac83533c7ca1286bae893f4b63a128bac02d)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **common,ingest:** pluggable chunker interface with built-in implementations ([f47488b](https://github.com/SgtPooki/wtfoc/commit/f47488bcb2bad4fd9f46b3ba286fc127ce7a725a))
* **config:** .wtfoc.json project config file ([#151](https://github.com/SgtPooki/wtfoc/issues/151)) ([b72310c](https://github.com/SgtPooki/wtfoc/commit/b72310cd57ff508eb326a433d86f85ecd8e0f194))
* **config:** .wtfocignore support and expanded default exclusions ([#156](https://github.com/SgtPooki/wtfoc/issues/156)) ([1626300](https://github.com/SgtPooki/wtfoc/commit/1626300f4e92e6a001e1c504457fbdd9fba15e91))
* context-aware bare #N resolution for Slack/Discord edges ([#74](https://github.com/SgtPooki/wtfoc/issues/74)) ([9d227a8](https://github.com/SgtPooki/wtfoc/commit/9d227a8adb836427c89dae96662fc50ed6384cf8))
* derived layer compaction + temporal-semantic edges + AST-heuristic chunking ([#205](https://github.com/SgtPooki/wtfoc/issues/205)) ([16da274](https://github.com/SgtPooki/wtfoc/commit/16da2742430e76cae11b0653cd849112169820ac))
* holistic dogfood evaluation framework ([#206](https://github.com/SgtPooki/wtfoc/issues/206)) ([#213](https://github.com/SgtPooki/wtfoc/issues/213)) ([6901fd9](https://github.com/SgtPooki/wtfoc/commit/6901fd9a44f0b2f6ce2c570dbb3453a8cff93d3a))
* improve edge quality — fix prompt-validator mismatch and edge resolution ([#234](https://github.com/SgtPooki/wtfoc/issues/234), [#193](https://github.com/SgtPooki/wtfoc/issues/193)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* improve edge quality — fix prompt-validator mismatch and edge resolution ([#243](https://github.com/SgtPooki/wtfoc/issues/243)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* **ingest,cli:** derived edge layers as immutable artifacts ([28ec3d7](https://github.com/SgtPooki/wtfoc/commit/28ec3d7af78864ce553b30c91ba0e9552255a78e))
* **ingest,trace:** TimestampKind provenance + kindPairs drill-down on coherence ([df85d06](https://github.com/SgtPooki/wtfoc/commit/df85d0620b7867dab55cfe69ac6044d1a58fe0dc))
* **ingest:** add document identity to all source adapters ([2985a7e](https://github.com/SgtPooki/wtfoc/commit/2985a7eb15976e7d87a0f2c4d0cb026aa8e39fbb))
* **ingest:** add document identity to repo adapter ([e6d5720](https://github.com/SgtPooki/wtfoc/commit/e6d5720ba1c2032819a407c0033f9d66767f39e1))
* **ingest:** add temporal metadata to code chunks ([#231](https://github.com/SgtPooki/wtfoc/issues/231)) ([#240](https://github.com/SgtPooki/wtfoc/issues/240)) ([3a55d5f](https://github.com/SgtPooki/wtfoc/commit/3a55d5f567544f8d768d94ca957eefdd23e7d23b))
* **ingest:** AST-aware code chunker with sidecar integration (Session 1) ([20a7be2](https://github.com/SgtPooki/wtfoc/commit/20a7be274f9e2ee16fb4fe36fe54febf4ae6f047)), closes [#220](https://github.com/SgtPooki/wtfoc/issues/220)
* **ingest:** async EdgeExtractor pipeline with composite + heuristic extractors ([#133](https://github.com/SgtPooki/wtfoc/issues/133)) ([03946c3](https://github.com/SgtPooki/wtfoc/commit/03946c3fad1c6a16cdac9b8fb616adf3cf61dddf))
* **ingest:** auto-resolve GitHub App auth from env vars ([#212](https://github.com/SgtPooki/wtfoc/issues/212)) ([0ea86a5](https://github.com/SgtPooki/wtfoc/commit/0ea86a526becd1957eb89e5045b15dfb6e727d1d))
* **ingest:** canonical edge vocabulary and structured evidence on all edges ([a04ffd2](https://github.com/SgtPooki/wtfoc/commit/a04ffd210e4c192ca3815b62678e6b2a5acae3b2))
* **ingest:** code edge extractor with oxc-parser + multi-language support ([#136](https://github.com/SgtPooki/wtfoc/issues/136)) ([e64c44e](https://github.com/SgtPooki/wtfoc/commit/e64c44eec0392918fb2385638c9274f184f6c0e8))
* **ingest:** configurable chunking, structural overlap, GitHub issue chunker, span provenance ([2c8bde1](https://github.com/SgtPooki/wtfoc/commit/2c8bde178857b3fe4b20b4647df71b5c824c65a1))
* **ingest:** cross-collection source fetch deduplication ([#224](https://github.com/SgtPooki/wtfoc/issues/224)) ([e557518](https://github.com/SgtPooki/wtfoc/commit/e5575187bc2e8e19a2384644dd67a48cc40c9686))
* **ingest:** default donor reuse to raw-archive-only; opt-in for chunk dedup ([6072f83](https://github.com/SgtPooki/wtfoc/commit/6072f83e7cd1e7ed7bbaee1ccb9abf630e0378c4))
* **ingest:** edge-quality evaluation harness ([#204](https://github.com/SgtPooki/wtfoc/issues/204)) ([9b3b69b](https://github.com/SgtPooki/wtfoc/commit/9b3b69bc8a5432af6f8635b83cbad9d6ffb9ffc4))
* **ingest:** git-diff based incremental repo ingest ([aaaefca](https://github.com/SgtPooki/wtfoc/commit/aaaefca2d32434d743df3a86ac46c4cbde48bb86)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **ingest:** GitHub App auth module with token providers ([aeacda0](https://github.com/SgtPooki/wtfoc/commit/aeacda07f2958446536dca4516984979317fcce9))
* **ingest:** hierarchical code chunker emits file-level summary chunks ([36cb410](https://github.com/SgtPooki/wtfoc/commit/36cb4109a2a4b6c84d691074470d91aefdb21db0))
* **ingest:** incremental ingest pipeline ([#102](https://github.com/SgtPooki/wtfoc/issues/102)) ([#152](https://github.com/SgtPooki/wtfoc/issues/152)) ([4620081](https://github.com/SgtPooki/wtfoc/commit/4620081c8c0df113b45659ee1fefe4243ff8f195))
* **ingest:** iteration 3 edge gates — status language and concept grounding ([460e2b0](https://github.com/SgtPooki/wtfoc/commit/460e2b0076d8d4f364cce5694fa85dae35e7d965))
* **ingest:** LLM edge extractor with source-agnostic prompt ([#138](https://github.com/SgtPooki/wtfoc/issues/138)) ([55fa564](https://github.com/SgtPooki/wtfoc/commit/55fa564e0f6697ae7cf4ee006adffb3f7da445c9))
* **ingest:** post-extraction acceptance gates for LLM edges ([db6ea6e](https://github.com/SgtPooki/wtfoc/commit/db6ea6e2842641ae4f04a859dbdff8382c4b6df7))
* **ingest:** raw source archive — store originals before chunking ([82a97f6](https://github.com/SgtPooki/wtfoc/commit/82a97f6273a28064d22245ee9928802618eedffd))
* **ingest:** readability-based main-content extraction for website adapter closes [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([a14d414](https://github.com/SgtPooki/wtfoc/commit/a14d414db830c4ad42e602dda8097d85eba776d6))
* **ingest:** reingest --replay-raw routes archived raw content through current chunkers ([dfcecde](https://github.com/SgtPooki/wtfoc/commit/dfcecde7635cdb08062e5a1d17b70b616533f9c1))
* **ingest:** relation-specific acceptance gates with downgrade logic ([bc91e77](https://github.com/SgtPooki/wtfoc/commit/bc91e77786dd5c6cd9ab145691e5e74c3606e2ff))
* **ingest:** structural extractor synthesizes contains edges summary→symbol ([#285](https://github.com/SgtPooki/wtfoc/issues/285)) ([d99c1d1](https://github.com/SgtPooki/wtfoc/commit/d99c1d180478f0dd9f81fc3317310c7df861da97))
* **ingest:** unified extractor API for post-ingest edge overlays fixes [#215](https://github.com/SgtPooki/wtfoc/issues/215) ([3546895](https://github.com/SgtPooki/wtfoc/commit/3546895d0d631b4f6a3a31a7f190f5ee8e04bcca))
* **ingest:** website adapter --deny-path pattern filter ref [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([d26b17e](https://github.com/SgtPooki/wtfoc/commit/d26b17e10af12b6042070f2ee91453c85897016f))
* **ingest:** website adapter — shingle-based cross-page boilerplate dedup ref [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([ae138f7](https://github.com/SgtPooki/wtfoc/commit/ae138f77fec613ad55ef890df2ccc9164d6067ca))
* **ingest:** website crawler depth & page controls ([#165](https://github.com/SgtPooki/wtfoc/issues/165)) ([21c237f](https://github.com/SgtPooki/wtfoc/commit/21c237f1414a14b561119144a5ba332394a524b0))
* **ingest:** wire AST chunker into ingest + reingest ([#220](https://github.com/SgtPooki/wtfoc/issues/220) Session 2) ([de75fae](https://github.com/SgtPooki/wtfoc/commit/de75fae9f0eea20b3b4873d26e7818f4f8df8154))
* model-aware chunk sizing for GitHub/Slack/Discord adapters ([#96](https://github.com/SgtPooki/wtfoc/issues/96)) ([f3204d0](https://github.com/SgtPooki/wtfoc/commit/f3204d0551ca161222d08815817fccdaff34a237))
* overlay edges pipeline — extract, materialize, promote ([#162](https://github.com/SgtPooki/wtfoc/issues/162)) ([475450c](https://github.com/SgtPooki/wtfoc/commit/475450c876691dfa17e20102ec16a63b73fb6252))
* temporal edge extractor, configurable trace limits, source filtering ([7849558](https://github.com/SgtPooki/wtfoc/commit/784955891f16dea8406359a5c8c8c76ca9f6ea1e)), closes [#182](https://github.com/SgtPooki/wtfoc/issues/182)
* tree-sitter parser sidecar for polyglot code analysis ([#181](https://github.com/SgtPooki/wtfoc/issues/181)) ([0b8e0cc](https://github.com/SgtPooki/wtfoc/commit/0b8e0cc189a751831f36e097f84add0e39d20242))
* **web:** wallet-connected collection creation flow ([#183](https://github.com/SgtPooki/wtfoc/issues/183)) ([ecb04af](https://github.com/SgtPooki/wtfoc/commit/ecb04af4dbd22836eda84d553a6d0ac9fe7ea2b2))


### Bug Fixes

* apply biome formatting to unformatted files ([#184](https://github.com/SgtPooki/wtfoc/issues/184)) ([dfe4287](https://github.com/SgtPooki/wtfoc/commit/dfe42875ac368bbdf76813926bd2700043c07c9a))
* **cli+web:** address codex review of Session 2 before merging to main ([0bac1f6](https://github.com/SgtPooki/wtfoc/commit/0bac1f61ca4066c39f5b55bcf96d517a32b75500)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* **ingest:** 4 correctness bugs from Codex comprehensive review ([ef28a31](https://github.com/SgtPooki/wtfoc/commit/ef28a31a5973342a45d669f9745834d9b9030547)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **ingest:** acquireRepo detects broken clone caches and re-clones ([d86c7a5](https://github.com/SgtPooki/wtfoc/commit/d86c7a5dcdff26f9c6ed126a6ecfd1137d0def50))
* **ingest:** acquireRepo forces clone to remote HEAD, nukes on refresh failure ([49d0aa7](https://github.com/SgtPooki/wtfoc/commit/49d0aa7c7dd76276582253e65199c0140b03e457))
* **ingest:** address 5 bugs from Codex peer review ([307cad5](https://github.com/SgtPooki/wtfoc/commit/307cad529d5be10191096550ce3d0acb96c9921b)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **ingest:** address Codex follow-up on bug fixes ([ee18820](https://github.com/SgtPooki/wtfoc/commit/ee188207d233583bbb53229113d4c1681655304b))
* **ingest:** address codex review of AstChunker Session 1 ([c07b96f](https://github.com/SgtPooki/wtfoc/commit/c07b96f7f25f132b38f1501bf4f34bc1ba14d51b))
* **ingest:** correct AstHeuristicChunker span metadata after trim and large-chunk splits fixes [#248](https://github.com/SgtPooki/wtfoc/issues/248) ([b7abec1](https://github.com/SgtPooki/wtfoc/commit/b7abec1fbd8deb9d9184518a85d7995a0189344a))
* **ingest:** donor-replay derives timestampKind from sourceType + adds querying guide (gh-282, wtfoc-pnui) ([3eeb406](https://github.com/SgtPooki/wtfoc/commit/3eeb4063e6ebd0b95190374a201ea3517193f737))
* **ingest:** fix LLM extraction prompt and add 429 retry ([4c45a93](https://github.com/SgtPooki/wtfoc/commit/4c45a931d10b663b211f9541a991fdf09526fd8f))
* **ingest:** github-pr-comment chunks get distinct source from parent PR fixes [#258](https://github.com/SgtPooki/wtfoc/issues/258) ([1357fe6](https://github.com/SgtPooki/wtfoc/commit/1357fe62e57935117ca29f4b9220caa468fcb3ae))
* **ingest:** improve LLM response JSON parser for edge extraction ([8e2e5b1](https://github.com/SgtPooki/wtfoc/commit/8e2e5b1c2d3bf10b9df70d69e2d5b7053a6b29d6))
* **ingest:** increase LLM max_tokens to 4000 for edge extraction ([5b2ab3a](https://github.com/SgtPooki/wtfoc/commit/5b2ab3ae840e60156552c0a57e858b7f525ad1b1))
* **ingest:** lint fixes for biome check compliance ([3c71903](https://github.com/SgtPooki/wtfoc/commit/3c71903b7bfcc4ac79b973ea662a03301363fb6f))
* **ingest:** manifest single-chunk + multi-chunk reconstruction ([#178](https://github.com/SgtPooki/wtfoc/issues/178)) ([01b2e2e](https://github.com/SgtPooki/wtfoc/commit/01b2e2ee9ccb6e9d0136f1a00f3908804451ec96))
* **ingest:** namespace chunker provenance metadata keys ([#220](https://github.com/SgtPooki/wtfoc/issues/220) Session 3) ([89d5d0f](https://github.com/SgtPooki/wtfoc/commit/89d5d0f0a5906f34de9cc0856a32b8d2d8b1818a))
* **ingest:** preserve symbolPath on oversized symbol sub-chunks ([ef7d8ff](https://github.com/SgtPooki/wtfoc/commit/ef7d8ffe3a958382f1952b839001d43cf5fb9e59))
* **ingest:** prompt token overhead + flat status path ([#146](https://github.com/SgtPooki/wtfoc/issues/146), [#148](https://github.com/SgtPooki/wtfoc/issues/148)) ([#171](https://github.com/SgtPooki/wtfoc/issues/171)) ([3967c1c](https://github.com/SgtPooki/wtfoc/commit/3967c1c0b168055ec10b2b0e01f1c78070a55efa))
* **ingest:** propagate timestampKind through chunker wrappers ([97a2e03](https://github.com/SgtPooki/wtfoc/commit/97a2e031e49059e90cf7ccbcfdfb1a1569f3c679))
* **ingest:** reject relative file paths in validator, improve LLM targetType guidance ([510b5a9](https://github.com/SgtPooki/wtfoc/commit/510b5a95a41b29138f0815415cae84919b37ce40))
* **ingest:** shared semaphore, abort-aware retry, and batch failure logging ([86ca988](https://github.com/SgtPooki/wtfoc/commit/86ca9887f06f50fde746823d63ce8b13482b2565)), closes [#3](https://github.com/SgtPooki/wtfoc/issues/3)
* **ingest:** suppress edge extraction from low-signal web chunks ref [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([9969eb6](https://github.com/SgtPooki/wtfoc/commit/9969eb637097332fff67ec30cb93296749aed869))
* **ingest:** website adapter first pass — host-qualified source + DOM boilerplate strip ref [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([bb307d2](https://github.com/SgtPooki/wtfoc/commit/bb307d2de8f264bfd38d16d57a04c630cd09294c))
* promote biome warnings/infos to errors and fix all diagnostics ([734ab91](https://github.com/SgtPooki/wtfoc/commit/734ab91a31da5d238a3641bc77e41915881ce1a0))
* **search:** resolver correctness — strip org/repo prefix, normalize ./, add inScopeResolutionRate ref [#247](https://github.com/SgtPooki/wtfoc/issues/247) ([12f8d0e](https://github.com/SgtPooki/wtfoc/commit/12f8d0e957c6390f691b16909ec45c237932e4bf))


### Refactoring

* extract shared chat-ingest pipeline for Slack and Discord ([#82](https://github.com/SgtPooki/wtfoc/issues/82)) ([69e0098](https://github.com/SgtPooki/wtfoc/commit/69e0098d1515b06f39f04da0a631a6ab02a8051e))
* extract storedChunkToSegmentChunk() shared helper ([#233](https://github.com/SgtPooki/wtfoc/issues/233)) ([#238](https://github.com/SgtPooki/wtfoc/issues/238)) ([0f5fb29](https://github.com/SgtPooki/wtfoc/commit/0f5fb29b0752b8c0066e613d757d69172f04a70d))
* **ingest:** decouple ingest into composable pipeline stages ([#241](https://github.com/SgtPooki/wtfoc/issues/241)) ([f2db617](https://github.com/SgtPooki/wtfoc/commit/f2db6176e7def0d3942623ef588615d3d1666f59)), closes [#215](https://github.com/SgtPooki/wtfoc/issues/215)
* split GitHub adapter into transport and adapter modules ([#86](https://github.com/SgtPooki/wtfoc/issues/86)) ([6000e1b](https://github.com/SgtPooki/wtfoc/commit/6000e1bad84219c0571fdaaa5d7728d978875a13))
* split repo adapter into acquisition, chunking, and adapter modules ([#83](https://github.com/SgtPooki/wtfoc/issues/83)) ([3103263](https://github.com/SgtPooki/wtfoc/commit/31032632869cab734b2fa40ccd9400e7baa6f4c5))
* **store:** split schema validators by domain ([#91](https://github.com/SgtPooki/wtfoc/issues/91)) ([3a7dc0b](https://github.com/SgtPooki/wtfoc/commit/3a7dc0bb5c25a09ce341973f07b3c99ab88934b8))
* test suite quality — deduplicate, strengthen mocks, add HTTP E2E ([#236](https://github.com/SgtPooki/wtfoc/issues/236)) ([92d1f42](https://github.com/SgtPooki/wtfoc/commit/92d1f42ee2d0cdae4cede8604d7ac297ab110ee0))


### Documentation

* add per-package READMEs and switch to npm Trusted Publishing ([428d530](https://github.com/SgtPooki/wtfoc/commit/428d530c875b6ce1c6cb4c70f5a6499c0ab9de74))
* rewrite READMEs for onboarding and marketing ([#100](https://github.com/SgtPooki/wtfoc/issues/100)) ([43aa9f3](https://github.com/SgtPooki/wtfoc/commit/43aa9f3ebc93ff2f18baf256273e0bb6cc9950fc))

## [0.0.3](https://github.com/SgtPooki/wtfoc/compare/ingest-v0.0.2...ingest-v0.0.3) (2026-03-24)


### Features

* add Slack adapter for channel history ingestion ([#10](https://github.com/SgtPooki/wtfoc/issues/10)) ([1eb3001](https://github.com/SgtPooki/wtfoc/commit/1eb3001ab8d81b8fee55cbb999bfa066b6c5c784))
* **cli:** wire GitHub adapter + real data demo script ([#52](https://github.com/SgtPooki/wtfoc/issues/52)) ([800f552](https://github.com/SgtPooki/wtfoc/commit/800f552e55a82c4ec59792285d208a692bba0a35))
* **ingest:** Discord adapter with JSON import + bot token support ([#31](https://github.com/SgtPooki/wtfoc/issues/31)) ([4376cba](https://github.com/SgtPooki/wtfoc/commit/4376cbac4b420b8c24f7602c6259f5b723d1108e))
* **ingest:** GitHub adapter — issues, PRs, comments, discussions with rate limiting ([#50](https://github.com/SgtPooki/wtfoc/issues/50)) ([250f98b](https://github.com/SgtPooki/wtfoc/commit/250f98b65edf25f77ecd802faf8d946c64688ce3)), closes [#11](https://github.com/SgtPooki/wtfoc/issues/11)
* **ingest:** website adapter using crawlee + turndown ([#32](https://github.com/SgtPooki/wtfoc/issues/32)) ([c0e5832](https://github.com/SgtPooki/wtfoc/commit/c0e5832187ce83aa8ff8cef93170c432d2636143))


### Bug Fixes

* **ingest:** set storageId to chunk content hash instead of empty string ([4de76a5](https://github.com/SgtPooki/wtfoc/commit/4de76a5acadd0adfcbede10dc58eac726c5a1d2f)), closes [#49](https://github.com/SgtPooki/wtfoc/issues/49)


### Refactoring

* **cli:** replace if/else ingest chain with pluggable adapter registry ([#53](https://github.com/SgtPooki/wtfoc/issues/53)) ([4abec80](https://github.com/SgtPooki/wtfoc/commit/4abec8079ebdd8f4b52c7196477274d817f15de3))

## [0.0.2](https://github.com/SgtPooki/wtfoc/compare/ingest-v0.0.1...ingest-v0.0.2) (2026-03-23)


### Features

* centralize CURRENT_SCHEMA_VERSION + bidirectional edge traversal ([1bb671b](https://github.com/SgtPooki/wtfoc/commit/1bb671b6af021cbce7a8ebbfa4c2c817b0c566e4))
* **cli:** working CLI with init, ingest, trace, query, status, verify ([c5b80e9](https://github.com/SgtPooki/wtfoc/commit/c5b80e91f5bf4ba278d9e44d14fc5c406d665b5d))
* **ingest:** add repo/code source adapter for MVP demo ([d18a61f](https://github.com/SgtPooki/wtfoc/commit/d18a61facd87c5975b0129d98cb33cde3347bbb6))
* **ingest:** add segment builder with BM25 term extraction ([70b3e09](https://github.com/SgtPooki/wtfoc/commit/70b3e09daba33071bc7ef8b9a1aa1a187cc57b6f))
* **ingest:** scaffold @wtfoc/ingest package ([6a8b5b5](https://github.com/SgtPooki/wtfoc/commit/6a8b5b5a803f8cc71523929fcdf0a87d77c95233))


### Bug Fixes

* add content field to Segment chunks for display in results ([0612b26](https://github.com/SgtPooki/wtfoc/commit/0612b26d056a037c528409d4775ffb21d59c9291))
* enforce no non-null assertions + no double casts ([b478266](https://github.com/SgtPooki/wtfoc/commit/b478266deedc0c7cdd4f824479240bbf4336fbaa))
* removed unsafe type casts, proper option extraction from config. ([c5b80e9](https://github.com/SgtPooki/wtfoc/commit/c5b80e91f5bf4ba278d9e44d14fc5c406d665b5d))
* standardize test scripts + fix agent-loop local-in-loop error ([d27f42f](https://github.com/SgtPooki/wtfoc/commit/d27f42f90eae036834c590da7396131d3f5eaae7))


### Refactoring

* **common:** type-safe SourceAdapter with generic config + parseConfig ([7a92979](https://github.com/SgtPooki/wtfoc/commit/7a929798eed5a94198392075e8d276a8d9ed2034))

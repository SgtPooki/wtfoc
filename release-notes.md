:robot: I have created a release *beep* *boop*
---


<details><summary>common: 0.0.4</summary>

## [0.0.4](https://github.com/SgtPooki/wtfoc/compare/common-v0.0.3...common-v0.0.4) (2026-04-30)


### Features

* add collection descriptions for MCP agent discoverability ([#185](https://github.com/SgtPooki/wtfoc/issues/185)) ([3051dcd](https://github.com/SgtPooki/wtfoc/commit/3051dcde9c0ad724d90858ddcb51e6f62b3f3baf))
* add multi-signal chunk scoring with heuristic scorer ([#61](https://github.com/SgtPooki/wtfoc/issues/61)) ([63d4523](https://github.com/SgtPooki/wtfoc/commit/63d4523502b49ebdc20ebdf626a108162b28965b))
* add theme clustering with Clusterer interface and CLI command ([9a6a621](https://github.com/SgtPooki/wtfoc/commit/9a6a62150767efec4e09a9b07592853febb12f4e)), closes [#59](https://github.com/SgtPooki/wtfoc/issues/59)
* **cli:** LLM-powered theme labels, noise summary, config filtering ([#179](https://github.com/SgtPooki/wtfoc/issues/179)) ([354c565](https://github.com/SgtPooki/wtfoc/commit/354c56527b6f7f42c7942fb01dbcdc908e3d75a2))
* **common,ingest:** add document identity model and version-aware chunk IDs ([0a95ac8](https://github.com/SgtPooki/wtfoc/commit/0a95ac83533c7ca1286bae893f4b63a128bac02d)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **common,ingest:** pluggable chunker interface with built-in implementations ([f47488b](https://github.com/SgtPooki/wtfoc/commit/f47488bcb2bad4fd9f46b3ba286fc127ce7a725a))
* **config:** .wtfoc.json project config file ([#151](https://github.com/SgtPooki/wtfoc/issues/151)) ([b72310c](https://github.com/SgtPooki/wtfoc/commit/b72310cd57ff508eb326a433d86f85ecd8e0f194))
* **config:** .wtfocignore support and expanded default exclusions ([#156](https://github.com/SgtPooki/wtfoc/issues/156)) ([1626300](https://github.com/SgtPooki/wtfoc/commit/1626300f4e92e6a001e1c504457fbdd9fba15e91))
* **embedder:** configurable model profiles ([#170](https://github.com/SgtPooki/wtfoc/issues/170)) ([df9cce6](https://github.com/SgtPooki/wtfoc/commit/df9cce6649a77c5b26792f2e3b3a5901c06e6c1a))
* holistic dogfood evaluation framework ([#206](https://github.com/SgtPooki/wtfoc/issues/206)) ([#213](https://github.com/SgtPooki/wtfoc/issues/213)) ([6901fd9](https://github.com/SgtPooki/wtfoc/commit/6901fd9a44f0b2f6ce2c570dbb3453a8cff93d3a))
* **ingest,cli:** derived edge layers as immutable artifacts ([28ec3d7](https://github.com/SgtPooki/wtfoc/commit/28ec3d7af78864ce553b30c91ba0e9552255a78e))
* **ingest,trace:** TimestampKind provenance + kindPairs drill-down on coherence ([df85d06](https://github.com/SgtPooki/wtfoc/commit/df85d0620b7867dab55cfe69ac6044d1a58fe0dc))
* **ingest:** AST-aware code chunker with sidecar integration (Session 1) ([20a7be2](https://github.com/SgtPooki/wtfoc/commit/20a7be274f9e2ee16fb4fe36fe54febf4ae6f047)), closes [#220](https://github.com/SgtPooki/wtfoc/issues/220)
* **ingest:** async EdgeExtractor pipeline with composite + heuristic extractors ([#133](https://github.com/SgtPooki/wtfoc/issues/133)) ([03946c3](https://github.com/SgtPooki/wtfoc/commit/03946c3fad1c6a16cdac9b8fb616adf3cf61dddf))
* **ingest:** configurable chunking, structural overlap, GitHub issue chunker, span provenance ([2c8bde1](https://github.com/SgtPooki/wtfoc/commit/2c8bde178857b3fe4b20b4647df71b5c824c65a1))
* **ingest:** raw source archive  store originals before chunking ([82a97f6](https://github.com/SgtPooki/wtfoc/commit/82a97f6273a28064d22245ee9928802618eedffd))
* **ingest:** unified extractor API for post-ingest edge overlays fixes [#215](https://github.com/SgtPooki/wtfoc/issues/215) ([3546895](https://github.com/SgtPooki/wtfoc/commit/3546895d0d631b4f6a3a31a7f190f5ee8e04bcca))
* model-aware chunk sizing for GitHub/Slack/Discord adapters ([#96](https://github.com/SgtPooki/wtfoc/issues/96)) ([f3204d0](https://github.com/SgtPooki/wtfoc/commit/f3204d0551ca161222d08815817fccdaff34a237))
* pluggable vector backends with Qdrant support ([#106](https://github.com/SgtPooki/wtfoc/issues/106)) ([61a7ae5](https://github.com/SgtPooki/wtfoc/commit/61a7ae50173976da1c9b5b5308fdf53ba29c991c))
* **store+cli:** collection self-containment foundation (Session 1) ([de5a772](https://github.com/SgtPooki/wtfoc/commit/de5a772301125e38773a4b1aa81225d066936eec)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* **web:** wallet-connected collection creation flow ([#183](https://github.com/SgtPooki/wtfoc/issues/183)) ([ecb04af](https://github.com/SgtPooki/wtfoc/commit/ecb04af4dbd22836eda84d553a6d0ac9fe7ea2b2))


### Bug Fixes

* **config:** exclude test files and fixtures from default ingestion ([#157](https://github.com/SgtPooki/wtfoc/issues/157)) ([730b432](https://github.com/SgtPooki/wtfoc/commit/730b432e2b65a5c5d33b73ee7211bad1dedd8441))
* **ingest:** 4 correctness bugs from Codex comprehensive review ([ef28a31](https://github.com/SgtPooki/wtfoc/commit/ef28a31a5973342a45d669f9745834d9b9030547)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **ingest:** address 5 bugs from Codex peer review ([307cad5](https://github.com/SgtPooki/wtfoc/commit/307cad529d5be10191096550ce3d0acb96c9921b)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **ingest:** correct AstHeuristicChunker span metadata after trim and large-chunk splits fixes [#248](https://github.com/SgtPooki/wtfoc/issues/248) ([b7abec1](https://github.com/SgtPooki/wtfoc/commit/b7abec1fbd8deb9d9184518a85d7995a0189344a))


### Documentation

* add per-package READMEs and switch to npm Trusted Publishing ([428d530](https://github.com/SgtPooki/wtfoc/commit/428d530c875b6ce1c6cb4c70f5a6499c0ab9de74))
</details>

<details><summary>store: 0.0.4</summary>

## [0.0.4](https://github.com/SgtPooki/wtfoc/compare/store-v0.0.3...store-v0.0.4) (2026-04-30)


### Features

* add collection descriptions for MCP agent discoverability ([#185](https://github.com/SgtPooki/wtfoc/issues/185)) ([3051dcd](https://github.com/SgtPooki/wtfoc/commit/3051dcde9c0ad724d90858ddcb51e6f62b3f3baf))
* add multi-signal chunk scoring with heuristic scorer ([#61](https://github.com/SgtPooki/wtfoc/issues/61)) ([63d4523](https://github.com/SgtPooki/wtfoc/commit/63d4523502b49ebdc20ebdf626a108162b28965b))
* CID-based collection resolution  thin vertical slice ([#94](https://github.com/SgtPooki/wtfoc/issues/94)) ([5b835d1](https://github.com/SgtPooki/wtfoc/commit/5b835d19575924a659ad9cc8a5a67888bcb02731))
* **cli+web:** promote and pull use self-containment publication index (Session 2) ([03a8fc8](https://github.com/SgtPooki/wtfoc/commit/03a8fc85837199b395da7fcfdfdb0601876a5e4a)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* **cli:** add wtfoc extract-edges command for incremental LLM extraction ([#145](https://github.com/SgtPooki/wtfoc/issues/145)) ([a8787a8](https://github.com/SgtPooki/wtfoc/commit/a8787a8f018d371c18480aa76d818a2e25ac8449))
* **cli:** add wtfoc extract-edges command for incremental LLM extraction ([#3](https://github.com/SgtPooki/wtfoc/issues/3)) ([a8787a8](https://github.com/SgtPooki/wtfoc/commit/a8787a8f018d371c18480aa76d818a2e25ac8449))
* **cli:** LLM-powered theme labels, noise summary, config filtering ([#179](https://github.com/SgtPooki/wtfoc/issues/179)) ([354c565](https://github.com/SgtPooki/wtfoc/commit/354c56527b6f7f42c7942fb01dbcdc908e3d75a2))
* derived layer compaction + temporal-semantic edges + AST-heuristic chunking ([#205](https://github.com/SgtPooki/wtfoc/issues/205)) ([16da274](https://github.com/SgtPooki/wtfoc/commit/16da2742430e76cae11b0653cd849112169820ac))
* holistic dogfood evaluation framework ([#206](https://github.com/SgtPooki/wtfoc/issues/206)) ([#213](https://github.com/SgtPooki/wtfoc/issues/213)) ([6901fd9](https://github.com/SgtPooki/wtfoc/commit/6901fd9a44f0b2f6ce2c570dbb3453a8cff93d3a))
* **ingest:** async EdgeExtractor pipeline with composite + heuristic extractors ([#133](https://github.com/SgtPooki/wtfoc/issues/133)) ([03946c3](https://github.com/SgtPooki/wtfoc/commit/03946c3fad1c6a16cdac9b8fb616adf3cf61dddf))
* **ingest:** unified extractor API for post-ingest edge overlays fixes [#215](https://github.com/SgtPooki/wtfoc/issues/215) ([3546895](https://github.com/SgtPooki/wtfoc/commit/3546895d0d631b4f6a3a31a7f190f5ee8e04bcca))
* **promote:** upload manifest to Filecoin and output shareable CID ([8b548a6](https://github.com/SgtPooki/wtfoc/commit/8b548a634070fcfea899f59994edc1f9f1b4ed7a)), closes [#94](https://github.com/SgtPooki/wtfoc/issues/94)
* **store+cli:** collection self-containment foundation (Session 1) ([de5a772](https://github.com/SgtPooki/wtfoc/commit/de5a772301125e38773a4b1aa81225d066936eec)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* **store+web:** env-var store paths + unauth CID pull endpoint ([77cd6c6](https://github.com/SgtPooki/wtfoc/commit/77cd6c654a9bb18221dbe6b5dbb01404a439af2c))
* **web:** add /mcp HTTP endpoint for remote MCP access ([#98](https://github.com/SgtPooki/wtfoc/issues/98)) ([034524c](https://github.com/SgtPooki/wtfoc/commit/034524c8cc3ca926a2173676fd6c6c6731b7cb55))
* **web:** wallet-connected collection creation flow ([#183](https://github.com/SgtPooki/wtfoc/issues/183)) ([ecb04af](https://github.com/SgtPooki/wtfoc/commit/ecb04af4dbd22836eda84d553a6d0ac9fe7ea2b2))


### Bug Fixes

* **cli+web:** address codex review of Session 2 before merging to main ([0bac1f6](https://github.com/SgtPooki/wtfoc/commit/0bac1f61ca4066c39f5b55bcf96d517a32b75500)), closes [#271](https://github.com/SgtPooki/wtfoc/issues/271)
* collection name validation and sidecar file filtering ([#209](https://github.com/SgtPooki/wtfoc/issues/209)) ([658b711](https://github.com/SgtPooki/wtfoc/commit/658b7117fe8d3b1e39b36f982012a4202145fe38))
* format promote.ts and cid-reader.ts for biome ([4e9942c](https://github.com/SgtPooki/wtfoc/commit/4e9942cc861546c77a02c7ff3311d0887d4b2e12))
* promote biome warnings/infos to errors and fix all diagnostics ([734ab91](https://github.com/SgtPooki/wtfoc/commit/734ab91a31da5d238a3641bc77e41915881ce1a0))
* **store:** manifest schema accepts self-contained published manifests ([6b3a9eb](https://github.com/SgtPooki/wtfoc/commit/6b3a9eb8b7c5291ab02cb1f467f18481adc49dd3))
* **store:** per-download timeout + gateway fallback on helia hang ([#43](https://github.com/SgtPooki/wtfoc/issues/43)) ([2fe2a14](https://github.com/SgtPooki/wtfoc/commit/2fe2a14ff8f7d030c7ae04dbd20a52de76716716))
* **store:** release helia on CidReadableStorage.close() + plumb through ([f09a59d](https://github.com/SgtPooki/wtfoc/commit/f09a59d5eed84ad5b90ab1cf27ad86e086f8855b))
* **store:** use bare CIDs for IPNI indexing, single-CAR promote flow ([#147](https://github.com/SgtPooki/wtfoc/issues/147)) ([0798030](https://github.com/SgtPooki/wtfoc/commit/0798030a152854e359b3b7c1943b3d3402f35058))
* **store:** verified-fetch Helia config drops webRTC transports ([22de31f](https://github.com/SgtPooki/wtfoc/commit/22de31f9d28f2787c54eefdbc8c65f0f6f544d12))


### Refactoring

* move FOC deps from root to @wtfoc/store ([090c559](https://github.com/SgtPooki/wtfoc/commit/090c5592863ab3e2c56f64b10eed844f5c6d2e98))
* **store:** split schema validators by domain ([#91](https://github.com/SgtPooki/wtfoc/issues/91)) ([3a7dc0b](https://github.com/SgtPooki/wtfoc/commit/3a7dc0bb5c25a09ce341973f07b3c99ab88934b8))


### Documentation

* add per-package READMEs and switch to npm Trusted Publishing ([428d530](https://github.com/SgtPooki/wtfoc/commit/428d530c875b6ce1c6cb4c70f5a6499c0ab9de74))
</details>

<details><summary>ingest: 0.0.4</summary>

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
* improve edge quality  fix prompt-validator mismatch and edge resolution ([#234](https://github.com/SgtPooki/wtfoc/issues/234), [#193](https://github.com/SgtPooki/wtfoc/issues/193)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* improve edge quality  fix prompt-validator mismatch and edge resolution ([#243](https://github.com/SgtPooki/wtfoc/issues/243)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
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
* **ingest:** iteration 3 edge gates  status language and concept grounding ([460e2b0](https://github.com/SgtPooki/wtfoc/commit/460e2b0076d8d4f364cce5694fa85dae35e7d965))
* **ingest:** LLM edge extractor with source-agnostic prompt ([#138](https://github.com/SgtPooki/wtfoc/issues/138)) ([55fa564](https://github.com/SgtPooki/wtfoc/commit/55fa564e0f6697ae7cf4ee006adffb3f7da445c9))
* **ingest:** post-extraction acceptance gates for LLM edges ([db6ea6e](https://github.com/SgtPooki/wtfoc/commit/db6ea6e2842641ae4f04a859dbdff8382c4b6df7))
* **ingest:** raw source archive  store originals before chunking ([82a97f6](https://github.com/SgtPooki/wtfoc/commit/82a97f6273a28064d22245ee9928802618eedffd))
* **ingest:** readability-based main-content extraction for website adapter closes [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([a14d414](https://github.com/SgtPooki/wtfoc/commit/a14d414db830c4ad42e602dda8097d85eba776d6))
* **ingest:** reingest --replay-raw routes archived raw content through current chunkers ([dfcecde](https://github.com/SgtPooki/wtfoc/commit/dfcecde7635cdb08062e5a1d17b70b616533f9c1))
* **ingest:** relation-specific acceptance gates with downgrade logic ([bc91e77](https://github.com/SgtPooki/wtfoc/commit/bc91e77786dd5c6cd9ab145691e5e74c3606e2ff))
* **ingest:** structural extractor synthesizes contains edges summary’symbol ([#285](https://github.com/SgtPooki/wtfoc/issues/285)) ([d99c1d1](https://github.com/SgtPooki/wtfoc/commit/d99c1d180478f0dd9f81fc3317310c7df861da97))
* **ingest:** unified extractor API for post-ingest edge overlays fixes [#215](https://github.com/SgtPooki/wtfoc/issues/215) ([3546895](https://github.com/SgtPooki/wtfoc/commit/3546895d0d631b4f6a3a31a7f190f5ee8e04bcca))
* **ingest:** website adapter --deny-path pattern filter ref [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([d26b17e](https://github.com/SgtPooki/wtfoc/commit/d26b17e10af12b6042070f2ee91453c85897016f))
* **ingest:** website adapter  shingle-based cross-page boilerplate dedup ref [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([ae138f7](https://github.com/SgtPooki/wtfoc/commit/ae138f77fec613ad55ef890df2ccc9164d6067ca))
* **ingest:** website crawler depth & page controls ([#165](https://github.com/SgtPooki/wtfoc/issues/165)) ([21c237f](https://github.com/SgtPooki/wtfoc/commit/21c237f1414a14b561119144a5ba332394a524b0))
* **ingest:** wire AST chunker into ingest + reingest ([#220](https://github.com/SgtPooki/wtfoc/issues/220) Session 2) ([de75fae](https://github.com/SgtPooki/wtfoc/commit/de75fae9f0eea20b3b4873d26e7818f4f8df8154))
* model-aware chunk sizing for GitHub/Slack/Discord adapters ([#96](https://github.com/SgtPooki/wtfoc/issues/96)) ([f3204d0](https://github.com/SgtPooki/wtfoc/commit/f3204d0551ca161222d08815817fccdaff34a237))
* overlay edges pipeline  extract, materialize, promote ([#162](https://github.com/SgtPooki/wtfoc/issues/162)) ([475450c](https://github.com/SgtPooki/wtfoc/commit/475450c876691dfa17e20102ec16a63b73fb6252))
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
* **ingest:** website adapter first pass  host-qualified source + DOM boilerplate strip ref [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([bb307d2](https://github.com/SgtPooki/wtfoc/commit/bb307d2de8f264bfd38d16d57a04c630cd09294c))
* promote biome warnings/infos to errors and fix all diagnostics ([734ab91](https://github.com/SgtPooki/wtfoc/commit/734ab91a31da5d238a3641bc77e41915881ce1a0))
* **search:** resolver correctness  strip org/repo prefix, normalize ./, add inScopeResolutionRate ref [#247](https://github.com/SgtPooki/wtfoc/issues/247) ([12f8d0e](https://github.com/SgtPooki/wtfoc/commit/12f8d0e957c6390f691b16909ec45c237932e4bf))


### Refactoring

* extract shared chat-ingest pipeline for Slack and Discord ([#82](https://github.com/SgtPooki/wtfoc/issues/82)) ([69e0098](https://github.com/SgtPooki/wtfoc/commit/69e0098d1515b06f39f04da0a631a6ab02a8051e))
* extract storedChunkToSegmentChunk() shared helper ([#233](https://github.com/SgtPooki/wtfoc/issues/233)) ([#238](https://github.com/SgtPooki/wtfoc/issues/238)) ([0f5fb29](https://github.com/SgtPooki/wtfoc/commit/0f5fb29b0752b8c0066e613d757d69172f04a70d))
* **ingest:** decouple ingest into composable pipeline stages ([#241](https://github.com/SgtPooki/wtfoc/issues/241)) ([f2db617](https://github.com/SgtPooki/wtfoc/commit/f2db6176e7def0d3942623ef588615d3d1666f59)), closes [#215](https://github.com/SgtPooki/wtfoc/issues/215)
* split GitHub adapter into transport and adapter modules ([#86](https://github.com/SgtPooki/wtfoc/issues/86)) ([6000e1b](https://github.com/SgtPooki/wtfoc/commit/6000e1bad84219c0571fdaaa5d7728d978875a13))
* split repo adapter into acquisition, chunking, and adapter modules ([#83](https://github.com/SgtPooki/wtfoc/issues/83)) ([3103263](https://github.com/SgtPooki/wtfoc/commit/31032632869cab734b2fa40ccd9400e7baa6f4c5))
* **store:** split schema validators by domain ([#91](https://github.com/SgtPooki/wtfoc/issues/91)) ([3a7dc0b](https://github.com/SgtPooki/wtfoc/commit/3a7dc0bb5c25a09ce341973f07b3c99ab88934b8))
* test suite quality  deduplicate, strengthen mocks, add HTTP E2E ([#236](https://github.com/SgtPooki/wtfoc/issues/236)) ([92d1f42](https://github.com/SgtPooki/wtfoc/commit/92d1f42ee2d0cdae4cede8604d7ac297ab110ee0))


### Documentation

* add per-package READMEs and switch to npm Trusted Publishing ([428d530](https://github.com/SgtPooki/wtfoc/commit/428d530c875b6ce1c6cb4c70f5a6499c0ab9de74))
* rewrite READMEs for onboarding and marketing ([#100](https://github.com/SgtPooki/wtfoc/issues/100)) ([43aa9f3](https://github.com/SgtPooki/wtfoc/commit/43aa9f3ebc93ff2f18baf256273e0bb6cc9950fc))
</details>

<details><summary>search: 0.0.4</summary>

## [0.0.4](https://github.com/SgtPooki/wtfoc/compare/search-v0.0.3...search-v0.0.4) (2026-04-30)


### Features

* add multi-signal chunk scoring with heuristic scorer ([#61](https://github.com/SgtPooki/wtfoc/issues/61)) ([63d4523](https://github.com/SgtPooki/wtfoc/commit/63d4523502b49ebdc20ebdf626a108162b28965b))
* add semantic fallback for underrepresented source types in trace ([a55fc0b](https://github.com/SgtPooki/wtfoc/commit/a55fc0b6ecbb76cc5f2c55e527717b56959da9cf))
* add theme clustering with Clusterer interface and CLI command ([9a6a621](https://github.com/SgtPooki/wtfoc/commit/9a6a62150767efec4e09a9b07592853febb12f4e)), closes [#59](https://github.com/SgtPooki/wtfoc/issues/59)
* **cli:** LLM-powered theme labels, noise summary, config filtering ([#179](https://github.com/SgtPooki/wtfoc/issues/179)) ([354c565](https://github.com/SgtPooki/wtfoc/commit/354c56527b6f7f42c7942fb01dbcdc908e3d75a2))
* **dogfood:** per-source-type breakdown, overlay edges in search, gold standard queries ref [#247](https://github.com/SgtPooki/wtfoc/issues/247) ([c0d538e](https://github.com/SgtPooki/wtfoc/commit/c0d538eae8208d6541f89ed69a84a0cdd28d24c7))
* **dogfood:** thread --auto-route through search + quality-queries evaluators ref [#265](https://github.com/SgtPooki/wtfoc/issues/265) ([d3069f0](https://github.com/SgtPooki/wtfoc/commit/d3069f0bfe0d2045d2ed6f05f4708220b710c98e))
* **embedder:** configurable model profiles ([#170](https://github.com/SgtPooki/wtfoc/issues/170)) ([df9cce6](https://github.com/SgtPooki/wtfoc/commit/df9cce6649a77c5b26792f2e3b3a5901c06e6c1a))
* **eval:** autoresearch loop  instrumentation, sweep harness, first sweep findings (fixes [#311](https://github.com/SgtPooki/wtfoc/issues/311)) ([#317](https://github.com/SgtPooki/wtfoc/issues/317)) ([48a49a3](https://github.com/SgtPooki/wtfoc/commit/48a49a33bee56887f789f55e3122c6d34c96bb1d))
* **eval:** chainTemporalCoherence metric per edge type ([ba6283c](https://github.com/SgtPooki/wtfoc/commit/ba6283cdc7a0b7e8551dced4df7c06c65b87b97e))
* **eval:** file-level gold queries for dogfood ([#286](https://github.com/SgtPooki/wtfoc/issues/286)) ([7fb4a09](https://github.com/SgtPooki/wtfoc/commit/7fb4a09a8b0dbe456e48c94ad9bf7315532b2006))
* **eval:** lineage trace quality metrics for dogfood ([e96994c](https://github.com/SgtPooki/wtfoc/commit/e96994c7c2822bd7fe0a14ff1e5e5e7d54c88860)), closes [#217](https://github.com/SgtPooki/wtfoc/issues/217)
* **eval:** work-lineage gold queries for flagship demo (v1.2.0) ([d2db6b1](https://github.com/SgtPooki/wtfoc/commit/d2db6b1b72e770e5a060455d8959655f5bb804ab))
* holistic dogfood evaluation framework ([#206](https://github.com/SgtPooki/wtfoc/issues/206)) ([#213](https://github.com/SgtPooki/wtfoc/issues/213)) ([6901fd9](https://github.com/SgtPooki/wtfoc/commit/6901fd9a44f0b2f6ce2c570dbb3453a8cff93d3a))
* improve edge quality  fix prompt-validator mismatch and edge resolution ([#234](https://github.com/SgtPooki/wtfoc/issues/234), [#193](https://github.com/SgtPooki/wtfoc/issues/193)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* improve edge quality  fix prompt-validator mismatch and edge resolution ([#243](https://github.com/SgtPooki/wtfoc/issues/243)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* **ingest,trace:** TimestampKind provenance + kindPairs drill-down on coherence ([df85d06](https://github.com/SgtPooki/wtfoc/commit/df85d0620b7867dab55cfe69ac6044d1a58fe0dc))
* **ingest:** incremental ingest pipeline ([#102](https://github.com/SgtPooki/wtfoc/issues/102)) ([#152](https://github.com/SgtPooki/wtfoc/issues/152)) ([4620081](https://github.com/SgtPooki/wtfoc/commit/4620081c8c0df113b45659ee1fefe4243ff8f195))
* lineage-first trace output with timeline and agent conclusion ([#214](https://github.com/SgtPooki/wtfoc/issues/214)) ([3788100](https://github.com/SgtPooki/wtfoc/commit/3788100fcd0378cd4d0a88eb906d8876644260b1))
* model-aware chunk sizing for GitHub/Slack/Discord adapters ([#96](https://github.com/SgtPooki/wtfoc/issues/96)) ([f3204d0](https://github.com/SgtPooki/wtfoc/commit/f3204d0551ca161222d08815817fccdaff34a237))
* overlay edges pipeline  extract, materialize, promote ([#162](https://github.com/SgtPooki/wtfoc/issues/162)) ([475450c](https://github.com/SgtPooki/wtfoc/commit/475450c876691dfa17e20102ec16a63b73fb6252))
* pluggable vector backends with Qdrant support ([#106](https://github.com/SgtPooki/wtfoc/issues/106)) ([61a7ae5](https://github.com/SgtPooki/wtfoc/commit/61a7ae50173976da1c9b5b5308fdf53ba29c991c))
* **reranker:** native MPS-aware reranker harness, drop Docker (refs [#319](https://github.com/SgtPooki/wtfoc/issues/319)) ([#325](https://github.com/SgtPooki/wtfoc/issues/325)) ([71a995a](https://github.com/SgtPooki/wtfoc/commit/71a995a4056ba148446888c346d79ff9c055cf18))
* **search,cli:** lifecycle-aware query and trace filtering ([b68a3c9](https://github.com/SgtPooki/wtfoc/commit/b68a3c9014e978e307b49c3c64c8745a4f01c851))
* **search:** add retry, backoff, and rate-limit pacing to OpenAIEmbedder ([fb90488](https://github.com/SgtPooki/wtfoc/commit/fb904883c64cc7068cfb22cc54ab183c32c7efff))
* **search:** BgeReranker sidecar and client for BAAI/bge-reranker-v2-m3 ref [#218](https://github.com/SgtPooki/wtfoc/issues/218) ([963d26d](https://github.com/SgtPooki/wtfoc/commit/963d26dfc56935ebdb1c1689f3597c89a6e29717))
* **search:** chunkLevelBoosts on QueryOptions + TraceOptions ([#287](https://github.com/SgtPooki/wtfoc/issues/287)) ([3a47512](https://github.com/SgtPooki/wtfoc/commit/3a4751273152d37bc84467b1f9406506fa3aac84))
* **search:** cross-source insight detection for analytical trace mode ([#159](https://github.com/SgtPooki/wtfoc/issues/159)) ([5708c69](https://github.com/SgtPooki/wtfoc/commit/5708c69c16a1e806d5efce0f2a4634259a08e2f7))
* **search:** diagnostics for boost-based routing (telemetry) ref [#265](https://github.com/SgtPooki/wtfoc/issues/265) ([b6e3b9f](https://github.com/SgtPooki/wtfoc/commit/b6e3b9f76ac6752a21bae3768cc191d179ed6881))
* **search:** hybrid scoring  diversityEnforce uses retrievalScore (refs [#313](https://github.com/SgtPooki/wtfoc/issues/313)) ([#326](https://github.com/SgtPooki/wtfoc/issues/326)) ([07d50fb](https://github.com/SgtPooki/wtfoc/commit/07d50fba73860a8f0fa88a96a222c91ec2afe3f7))
* **search:** LlmReranker  OpenAI-compat reranker via Claude proxy ref [#218](https://github.com/SgtPooki/wtfoc/issues/218) ([bb4357b](https://github.com/SgtPooki/wtfoc/commit/bb4357b8e9ee56a575fbcb8801c0a72a27978b3f))
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
* **search:** resolver correctness  strip org/repo prefix, normalize ./, add inScopeResolutionRate ref [#247](https://github.com/SgtPooki/wtfoc/issues/247) ([12f8d0e](https://github.com/SgtPooki/wtfoc/commit/12f8d0e957c6390f691b16909ec45c237932e4bf))
* **search:** sanitize Qdrant payload strings to prevent JSON parse errors ([ddea28b](https://github.com/SgtPooki/wtfoc/commit/ddea28b51cd0d229c5a325b1d610922547396201)), closes [#183](https://github.com/SgtPooki/wtfoc/issues/183)
* slim Docker image to 674MB, require explicit embedder config ([f2c88de](https://github.com/SgtPooki/wtfoc/commit/f2c88de512de13f284c31a9edbff7afd4c385c81))
* **trace:** include walkDirection in followEdges dedup key ([ff07390](https://github.com/SgtPooki/wtfoc/commit/ff0739017c78f95e25e23f5aa06fb44bf4191934))
* truncate inputs exceeding embedder context limit ([8ff50a2](https://github.com/SgtPooki/wtfoc/commit/8ff50a272fb6804edcfde13f416784e0f08b7390))


### Refactoring

* **runtime:** unify hydration, add cache freshness, document architecture ([#112](https://github.com/SgtPooki/wtfoc/issues/112)) ([f968fa6](https://github.com/SgtPooki/wtfoc/commit/f968fa65fb934b0a1ece693fa4c34ae9e4fcd491))
* split trace engine into indexing, resolution, and traversal modules ([#84](https://github.com/SgtPooki/wtfoc/issues/84)) ([c141949](https://github.com/SgtPooki/wtfoc/commit/c141949cf4eda98ff104cc6713c7f7b894dbf41d))
* test suite quality  deduplicate, strengthen mocks, add HTTP E2E ([#236](https://github.com/SgtPooki/wtfoc/issues/236)) ([92d1f42](https://github.com/SgtPooki/wtfoc/commit/92d1f42ee2d0cdae4cede8604d7ac297ab110ee0))


### Documentation

* add per-package READMEs and switch to npm Trusted Publishing ([428d530](https://github.com/SgtPooki/wtfoc/commit/428d530c875b6ce1c6cb4c70f5a6499c0ab9de74))
* rewrite READMEs for onboarding and marketing ([#100](https://github.com/SgtPooki/wtfoc/issues/100)) ([43aa9f3](https://github.com/SgtPooki/wtfoc/commit/43aa9f3ebc93ff2f18baf256273e0bb6cc9950fc))
</details>

<details><summary>cli: 0.0.4</summary>

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
* **cli:** wtfoc verify-collection  remote CID-walking trust report ([#43](https://github.com/SgtPooki/wtfoc/issues/43)) ([1346b28](https://github.com/SgtPooki/wtfoc/commit/1346b2861743155e05eb7785125e92a0dfbd93f4))
* **cli:** wtfoc verify-trust  minimal local trust report ([#43](https://github.com/SgtPooki/wtfoc/issues/43)) ([126ef58](https://github.com/SgtPooki/wtfoc/commit/126ef58d521dfb0980fc3a81a46e0d7d45402c88))
* **collections:** populate segment repo/time metadata ([#126](https://github.com/SgtPooki/wtfoc/issues/126)) ([#164](https://github.com/SgtPooki/wtfoc/issues/164)) ([d5cee6c](https://github.com/SgtPooki/wtfoc/commit/d5cee6c4d19553a57f83c7132760ada04096b10f))
* **config:** .wtfoc.json project config file ([#151](https://github.com/SgtPooki/wtfoc/issues/151)) ([b72310c](https://github.com/SgtPooki/wtfoc/commit/b72310cd57ff508eb326a433d86f85ecd8e0f194))
* **config:** .wtfocignore support and expanded default exclusions ([#156](https://github.com/SgtPooki/wtfoc/issues/156)) ([1626300](https://github.com/SgtPooki/wtfoc/commit/1626300f4e92e6a001e1c504457fbdd9fba15e91))
* derived layer compaction + temporal-semantic edges + AST-heuristic chunking ([#205](https://github.com/SgtPooki/wtfoc/issues/205)) ([16da274](https://github.com/SgtPooki/wtfoc/commit/16da2742430e76cae11b0653cd849112169820ac))
* **embedder:** configurable model profiles ([#170](https://github.com/SgtPooki/wtfoc/issues/170)) ([df9cce6](https://github.com/SgtPooki/wtfoc/commit/df9cce6649a77c5b26792f2e3b3a5901c06e6c1a))
* improve edge quality  fix prompt-validator mismatch and edge resolution ([#234](https://github.com/SgtPooki/wtfoc/issues/234), [#193](https://github.com/SgtPooki/wtfoc/issues/193)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* improve edge quality  fix prompt-validator mismatch and edge resolution ([#243](https://github.com/SgtPooki/wtfoc/issues/243)) ([6681c4c](https://github.com/SgtPooki/wtfoc/commit/6681c4ca7a37d6c158ba6dfe0aa51ccf95f1286b))
* **ingest,cli:** derived edge layers as immutable artifacts ([28ec3d7](https://github.com/SgtPooki/wtfoc/commit/28ec3d7af78864ce553b30c91ba0e9552255a78e))
* **ingest:** AST-aware code chunker with sidecar integration (Session 1) ([20a7be2](https://github.com/SgtPooki/wtfoc/commit/20a7be274f9e2ee16fb4fe36fe54febf4ae6f047)), closes [#220](https://github.com/SgtPooki/wtfoc/issues/220)
* **ingest:** async EdgeExtractor pipeline with composite + heuristic extractors ([#133](https://github.com/SgtPooki/wtfoc/issues/133)) ([03946c3](https://github.com/SgtPooki/wtfoc/commit/03946c3fad1c6a16cdac9b8fb616adf3cf61dddf))
* **ingest:** code edge extractor with oxc-parser + multi-language support ([#136](https://github.com/SgtPooki/wtfoc/issues/136)) ([e64c44e](https://github.com/SgtPooki/wtfoc/commit/e64c44eec0392918fb2385638c9274f184f6c0e8))
* **ingest:** cross-collection source fetch deduplication ([#224](https://github.com/SgtPooki/wtfoc/issues/224)) ([e557518](https://github.com/SgtPooki/wtfoc/commit/e5575187bc2e8e19a2384644dd67a48cc40c9686))
* **ingest:** default donor reuse to raw-archive-only; opt-in for chunk dedup ([6072f83](https://github.com/SgtPooki/wtfoc/commit/6072f83e7cd1e7ed7bbaee1ccb9abf630e0378c4))
* **ingest:** git-diff based incremental repo ingest ([aaaefca](https://github.com/SgtPooki/wtfoc/commit/aaaefca2d32434d743df3a86ac46c4cbde48bb86)), closes [#200](https://github.com/SgtPooki/wtfoc/issues/200)
* **ingest:** incremental ingest pipeline ([#102](https://github.com/SgtPooki/wtfoc/issues/102)) ([#152](https://github.com/SgtPooki/wtfoc/issues/152)) ([4620081](https://github.com/SgtPooki/wtfoc/commit/4620081c8c0df113b45659ee1fefe4243ff8f195))
* **ingest:** LLM edge extractor with source-agnostic prompt ([#138](https://github.com/SgtPooki/wtfoc/issues/138)) ([55fa564](https://github.com/SgtPooki/wtfoc/commit/55fa564e0f6697ae7cf4ee006adffb3f7da445c9))
* **ingest:** raw source archive  store originals before chunking ([82a97f6](https://github.com/SgtPooki/wtfoc/commit/82a97f6273a28064d22245ee9928802618eedffd))
* **ingest:** reingest --replay-raw routes archived raw content through current chunkers ([dfcecde](https://github.com/SgtPooki/wtfoc/commit/dfcecde7635cdb08062e5a1d17b70b616533f9c1))
* **ingest:** structural extractor synthesizes contains edges summary’symbol ([#285](https://github.com/SgtPooki/wtfoc/issues/285)) ([d99c1d1](https://github.com/SgtPooki/wtfoc/commit/d99c1d180478f0dd9f81fc3317310c7df861da97))
* **ingest:** unified extractor API for post-ingest edge overlays fixes [#215](https://github.com/SgtPooki/wtfoc/issues/215) ([3546895](https://github.com/SgtPooki/wtfoc/commit/3546895d0d631b4f6a3a31a7f190f5ee8e04bcca))
* **ingest:** website adapter --deny-path pattern filter ref [#257](https://github.com/SgtPooki/wtfoc/issues/257) ([d26b17e](https://github.com/SgtPooki/wtfoc/commit/d26b17e10af12b6042070f2ee91453c85897016f))
* **ingest:** website crawler depth & page controls ([#165](https://github.com/SgtPooki/wtfoc/issues/165)) ([21c237f](https://github.com/SgtPooki/wtfoc/commit/21c237f1414a14b561119144a5ba332394a524b0))
* **ingest:** wire AST chunker into ingest + reingest ([#220](https://github.com/SgtPooki/wtfoc/issues/220) Session 2) ([de75fae](https://github.com/SgtPooki/wtfoc/commit/de75fae9f0eea20b3b4873d26e7818f4f8df8154))
* lineage-first trace output with timeline and agent conclusion ([#214](https://github.com/SgtPooki/wtfoc/issues/214)) ([3788100](https://github.com/SgtPooki/wtfoc/commit/3788100fcd0378cd4d0a88eb906d8876644260b1))
* model-aware chunk sizing for GitHub/Slack/Discord adapters ([#96](https://github.com/SgtPooki/wtfoc/issues/96)) ([f3204d0](https://github.com/SgtPooki/wtfoc/commit/f3204d0551ca161222d08815817fccdaff34a237))
* overlay edges pipeline  extract, materialize, promote ([#162](https://github.com/SgtPooki/wtfoc/issues/162)) ([475450c](https://github.com/SgtPooki/wtfoc/commit/475450c876691dfa17e20102ec16a63b73fb6252))
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
* test suite quality  deduplicate, strengthen mocks, add HTTP E2E ([#236](https://github.com/SgtPooki/wtfoc/issues/236)) ([92d1f42](https://github.com/SgtPooki/wtfoc/commit/92d1f42ee2d0cdae4cede8604d7ac297ab110ee0))


### Documentation

* add per-package READMEs and switch to npm Trusted Publishing ([428d530](https://github.com/SgtPooki/wtfoc/commit/428d530c875b6ce1c6cb4c70f5a6499c0ab9de74))
* rewrite READMEs for onboarding and marketing ([#100](https://github.com/SgtPooki/wtfoc/issues/100)) ([43aa9f3](https://github.com/SgtPooki/wtfoc/commit/43aa9f3ebc93ff2f18baf256273e0bb6cc9950fc))
</details>

<details><summary>mcp-server: 0.0.4</summary>

## [0.0.4](https://github.com/SgtPooki/wtfoc/compare/mcp-server-v0.0.3...mcp-server-v0.0.4) (2026-04-30)


### Features

* add collection descriptions for MCP agent discoverability ([#185](https://github.com/SgtPooki/wtfoc/issues/185)) ([3051dcd](https://github.com/SgtPooki/wtfoc/commit/3051dcde9c0ad724d90858ddcb51e6f62b3f3baf))
* add web UI MVP with hosted multi-collection server ([#67](https://github.com/SgtPooki/wtfoc/issues/67)) ([38ee9ed](https://github.com/SgtPooki/wtfoc/commit/38ee9ed5a5b90362bbe3932d6e30200919704604))
* add wtfoc collections command and MCP tool ([#71](https://github.com/SgtPooki/wtfoc/issues/71)) ([95af0c5](https://github.com/SgtPooki/wtfoc/commit/95af0c577b47c6308f5c59f7fac83b8f70e89ec6))
* **config:** .wtfoc.json project config file ([#151](https://github.com/SgtPooki/wtfoc/issues/151)) ([b72310c](https://github.com/SgtPooki/wtfoc/commit/b72310cd57ff508eb326a433d86f85ecd8e0f194))
* **embedder:** configurable model profiles ([#170](https://github.com/SgtPooki/wtfoc/issues/170)) ([df9cce6](https://github.com/SgtPooki/wtfoc/commit/df9cce6649a77c5b26792f2e3b3a5901c06e6c1a))
* **ingest:** async EdgeExtractor pipeline with composite + heuristic extractors ([#133](https://github.com/SgtPooki/wtfoc/issues/133)) ([03946c3](https://github.com/SgtPooki/wtfoc/commit/03946c3fad1c6a16cdac9b8fb616adf3cf61dddf))
* **ingest:** code edge extractor with oxc-parser + multi-language support ([#136](https://github.com/SgtPooki/wtfoc/issues/136)) ([e64c44e](https://github.com/SgtPooki/wtfoc/commit/e64c44eec0392918fb2385638c9274f184f6c0e8))
* **mcp:** wire LLM edge extractor into MCP ingest handler ([#176](https://github.com/SgtPooki/wtfoc/issues/176)) ([9c09d4f](https://github.com/SgtPooki/wtfoc/commit/9c09d4f732210b318b3b8ab8fa748d68ee6470ed))
* **runtime:** wire /mcp endpoint tools into shared collection cache ([#169](https://github.com/SgtPooki/wtfoc/issues/169)) ([c1be1c8](https://github.com/SgtPooki/wtfoc/commit/c1be1c8993867f3370bcbe5a71e2f5f4d973562a))
* **search:** cross-source insight detection for analytical trace mode ([#159](https://github.com/SgtPooki/wtfoc/issues/159)) ([5708c69](https://github.com/SgtPooki/wtfoc/commit/5708c69c16a1e806d5efce0f2a4634259a08e2f7))
* temporal edge extractor, configurable trace limits, source filtering ([7849558](https://github.com/SgtPooki/wtfoc/commit/784955891f16dea8406359a5c8c8c76ca9f6ea1e)), closes [#182](https://github.com/SgtPooki/wtfoc/issues/182)
* tree-sitter parser sidecar for polyglot code analysis ([#181](https://github.com/SgtPooki/wtfoc/issues/181)) ([0b8e0cc](https://github.com/SgtPooki/wtfoc/commit/0b8e0cc189a751831f36e097f84add0e39d20242))
* **web:** add /mcp HTTP endpoint for remote MCP access ([#98](https://github.com/SgtPooki/wtfoc/issues/98)) ([034524c](https://github.com/SgtPooki/wtfoc/commit/034524c8cc3ca926a2173676fd6c6c6731b7cb55))


### Bug Fixes

* apply biome formatting to unformatted files ([#184](https://github.com/SgtPooki/wtfoc/issues/184)) ([dfe4287](https://github.com/SgtPooki/wtfoc/commit/dfe42875ac368bbdf76813926bd2700043c07c9a))
* **embedder:** don't route profile-only config to API embedder path ([#174](https://github.com/SgtPooki/wtfoc/issues/174)) ([b81a5b1](https://github.com/SgtPooki/wtfoc/commit/b81a5b1db7d4b947cd024b100b3daf7339099708)), closes [#172](https://github.com/SgtPooki/wtfoc/issues/172)
* promote biome warnings/infos to errors and fix all diagnostics ([734ab91](https://github.com/SgtPooki/wtfoc/commit/734ab91a31da5d238a3641bc77e41915881ce1a0))


### Refactoring

* **runtime:** unify hydration, add cache freshness, document architecture ([#112](https://github.com/SgtPooki/wtfoc/issues/112)) ([f968fa6](https://github.com/SgtPooki/wtfoc/commit/f968fa65fb934b0a1ece693fa4c34ae9e4fcd491))
* **store:** split schema validators by domain ([#91](https://github.com/SgtPooki/wtfoc/issues/91)) ([3a7dc0b](https://github.com/SgtPooki/wtfoc/commit/3a7dc0bb5c25a09ce341973f07b3c99ab88934b8))


### Documentation

* add per-package READMEs and switch to npm Trusted Publishing ([428d530](https://github.com/SgtPooki/wtfoc/commit/428d530c875b6ce1c6cb4c70f5a6499c0ab9de74))
* rewrite READMEs for onboarding and marketing ([#100](https://github.com/SgtPooki/wtfoc/issues/100)) ([43aa9f3](https://github.com/SgtPooki/wtfoc/commit/43aa9f3ebc93ff2f18baf256273e0bb6cc9950fc))
</details>

<details><summary>wtfoc: 0.0.4</summary>

## [0.0.4](https://github.com/SgtPooki/wtfoc/compare/wtfoc-v0.0.3...wtfoc-v0.0.4) (2026-04-30)


### Documentation

* add per-package READMEs and switch to npm Trusted Publishing ([428d530](https://github.com/SgtPooki/wtfoc/commit/428d530c875b6ce1c6cb4c70f5a6499c0ab9de74))
</details>

---
This PR was generated with [Release Please](https://github.com/googleapis/release-please). See [documentation](https://github.com/googleapis/release-please#release-please).
# Changelog

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
* **ingest:** raw source archive — store originals before chunking ([82a97f6](https://github.com/SgtPooki/wtfoc/commit/82a97f6273a28064d22245ee9928802618eedffd))
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

## [0.0.3](https://github.com/SgtPooki/wtfoc/compare/common-v0.0.2...common-v0.0.3) (2026-03-24)


### Features

* **ingest:** GitHub adapter — issues, PRs, comments, discussions with rate limiting ([#50](https://github.com/SgtPooki/wtfoc/issues/50)) ([250f98b](https://github.com/SgtPooki/wtfoc/commit/250f98b65edf25f77ecd802faf8d946c64688ce3)), closes [#11](https://github.com/SgtPooki/wtfoc/issues/11)

## [0.0.2](https://github.com/SgtPooki/wtfoc/compare/common-v0.0.1...common-v0.0.2) (2026-03-23)


### Features

* CAR bundle uploads — one ingest, one PieceCID ([#45](https://github.com/SgtPooki/wtfoc/issues/45)) ([6aa58ef](https://github.com/SgtPooki/wtfoc/commit/6aa58efc74db8f1302e1703c21bab86da1751b5f)), closes [#41](https://github.com/SgtPooki/wtfoc/issues/41)
* centralize CURRENT_SCHEMA_VERSION + bidirectional edge traversal ([1bb671b](https://github.com/SgtPooki/wtfoc/commit/1bb671b6af021cbce7a8ebbfa4c2c817b0c566e4))
* collection provenance — identity, revisions, mount, diff ([#46](https://github.com/SgtPooki/wtfoc/issues/46)) ([b6d08a3](https://github.com/SgtPooki/wtfoc/commit/b6d08a3179b969840cdd19a2617d77dc7fd422a5))
* **common:** scaffold @wtfoc/common with interfaces and schemas ([dbddaf5](https://github.com/SgtPooki/wtfoc/commit/dbddaf501089fce4d49488821f989409122412b7))


### Bug Fixes

* add content field to Segment chunks for display in results ([0612b26](https://github.com/SgtPooki/wtfoc/commit/0612b26d056a037c528409d4775ffb21d59c9291))
* **common:** address cross-review findings on interfaces and schemas ([25edf71](https://github.com/SgtPooki/wtfoc/commit/25edf71d4f7e646a539ed8da09bb4ce2f0a39438))
* standardize test scripts + fix agent-loop local-in-loop error ([d27f42f](https://github.com/SgtPooki/wtfoc/commit/d27f42f90eae036834c590da7396131d3f5eaae7))


### Refactoring

* **common:** type-safe SourceAdapter with generic config + parseConfig ([7a92979](https://github.com/SgtPooki/wtfoc/commit/7a929798eed5a94198392075e8d276a8d9ed2034))

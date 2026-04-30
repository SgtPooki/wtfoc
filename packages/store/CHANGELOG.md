# Changelog

## [0.0.4](https://github.com/SgtPooki/wtfoc/compare/store-v0.0.3...store-v0.0.4) (2026-04-30)


### Features

* add collection descriptions for MCP agent discoverability ([#185](https://github.com/SgtPooki/wtfoc/issues/185)) ([3051dcd](https://github.com/SgtPooki/wtfoc/commit/3051dcde9c0ad724d90858ddcb51e6f62b3f3baf))
* add multi-signal chunk scoring with heuristic scorer ([#61](https://github.com/SgtPooki/wtfoc/issues/61)) ([63d4523](https://github.com/SgtPooki/wtfoc/commit/63d4523502b49ebdc20ebdf626a108162b28965b))
* CID-based collection resolution — thin vertical slice ([#94](https://github.com/SgtPooki/wtfoc/issues/94)) ([5b835d1](https://github.com/SgtPooki/wtfoc/commit/5b835d19575924a659ad9cc8a5a67888bcb02731))
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

## [0.0.3](https://github.com/SgtPooki/wtfoc/compare/store-v0.0.2...store-v0.0.3) (2026-03-24)


### Refactoring

* **store:** replace hand-rolled schema validation with valibot ([#38](https://github.com/SgtPooki/wtfoc/issues/38)) ([dec4369](https://github.com/SgtPooki/wtfoc/commit/dec43695b6dae5b9ff0543cdb41cf79739009fc2))

## [0.0.2](https://github.com/SgtPooki/wtfoc/compare/store-v0.0.1...store-v0.0.2) (2026-03-23)


### Features

* CAR bundle uploads — one ingest, one PieceCID ([#45](https://github.com/SgtPooki/wtfoc/issues/45)) ([6aa58ef](https://github.com/SgtPooki/wtfoc/commit/6aa58efc74db8f1302e1703c21bab86da1751b5f)), closes [#41](https://github.com/SgtPooki/wtfoc/issues/41)
* collection provenance — identity, revisions, mount, diff ([#46](https://github.com/SgtPooki/wtfoc/issues/46)) ([b6d08a3](https://github.com/SgtPooki/wtfoc/commit/b6d08a3179b969840cdd19a2617d77dc7fd422a5))
* global --storage flag + FocStorageBackend build fixes ([56dac45](https://github.com/SgtPooki/wtfoc/commit/56dac45694f8a350f8edbeee1c7e881ec2bb7155))
* **store:** add createStore factory with pluggable backends ([26cc326](https://github.com/SgtPooki/wtfoc/commit/26cc32605260bc3c5cf9c985220366cdc664f412))
* **store:** FOC download via SP IPFS endpoint + public gateway fallback ([dde48b0](https://github.com/SgtPooki/wtfoc/commit/dde48b0023ecdc15342c39de87f39fada81b7455))
* **store:** FocStorageBackend with dual CIDs (IPFS + PieceCID) ([4b0c1ac](https://github.com/SgtPooki/wtfoc/commit/4b0c1ac90b2c3be21db43691bb40f2d4ca7f1c9a))
* **store:** implement FocStorageBackend with synapse-sdk ([9e32719](https://github.com/SgtPooki/wtfoc/commit/9e32719b54596c4512cfe47f8c32717fe8b66f77))
* **store:** implement LocalManifestStore with conflict detection ([fed6cb7](https://github.com/SgtPooki/wtfoc/commit/fed6cb73e8d2a3ab3e2cf2d743a6199cc6368162))
* **store:** implement LocalStorageBackend with tests ([cd52a7f](https://github.com/SgtPooki/wtfoc/commit/cd52a7f544f6033b6e8a2b4380cccfdf2a3349fb))
* **store:** scaffold @wtfoc/store with LocalStorageBackend ([44ec456](https://github.com/SgtPooki/wtfoc/commit/44ec45677ca742c3b4abd31354dd200ade8576cb))


### Bug Fixes

* add content field to Segment chunks for display in results ([0612b26](https://github.com/SgtPooki/wtfoc/commit/0612b26d056a037c528409d4775ffb21d59c9291))
* standardize test scripts + fix agent-loop local-in-loop error ([d27f42f](https://github.com/SgtPooki/wtfoc/commit/d27f42f90eae036834c590da7396131d3f5eaae7))
* **store:** remove hardcoded SP endpoints, use IPFS gateways + synapse SDK ([6d666af](https://github.com/SgtPooki/wtfoc/commit/6d666afd1baae07db1b074a5ce0c7c87fe7f2245))
* **store:** use bare CAR for direct file CID (no directory wrapper) ([ef59370](https://github.com/SgtPooki/wtfoc/commit/ef5937047b00acd26a6e83f0b1de66cea02a3e72))

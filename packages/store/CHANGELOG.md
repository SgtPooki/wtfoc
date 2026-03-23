# Changelog

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

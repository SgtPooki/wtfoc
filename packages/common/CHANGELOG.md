# Changelog

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

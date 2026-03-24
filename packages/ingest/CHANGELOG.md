# Changelog

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

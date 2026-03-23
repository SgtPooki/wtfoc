# Changelog

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

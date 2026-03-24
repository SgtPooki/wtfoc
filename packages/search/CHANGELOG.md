# Changelog

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

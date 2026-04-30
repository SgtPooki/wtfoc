# Changelog

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

## [0.0.3](https://github.com/SgtPooki/wtfoc/compare/mcp-server-v0.0.2...mcp-server-v0.0.3) (2026-03-24)


### Features

* add @wtfoc/mcp-server — MCP tools for trace, query, ingest, status ([#66](https://github.com/SgtPooki/wtfoc/issues/66)) ([782dfe7](https://github.com/SgtPooki/wtfoc/commit/782dfe754cae82f74d34a48164c6a3854ab04d49))
* improve multi-hop edge traversal with indexed lookups ([#68](https://github.com/SgtPooki/wtfoc/issues/68)) ([63fddf9](https://github.com/SgtPooki/wtfoc/commit/63fddf913f3ced1ae0885f7788842eb04291617a))

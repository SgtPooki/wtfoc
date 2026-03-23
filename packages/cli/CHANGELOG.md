# Changelog

## [0.0.2](https://github.com/SgtPooki/wtfoc/compare/cli-v0.0.1...cli-v0.0.2) (2026-03-23)


### Features

* CAR bundle uploads — one ingest, one PieceCID ([#45](https://github.com/SgtPooki/wtfoc/issues/45)) ([6aa58ef](https://github.com/SgtPooki/wtfoc/commit/6aa58efc74db8f1302e1703c21bab86da1751b5f)), closes [#41](https://github.com/SgtPooki/wtfoc/issues/41)
* centralize CURRENT_SCHEMA_VERSION + bidirectional edge traversal ([1bb671b](https://github.com/SgtPooki/wtfoc/commit/1bb671b6af021cbce7a8ebbfa4c2c817b0c566e4))
* **cli:** add ollama embedder shortcut + filecoin-pay repos to demo ([723c7cb](https://github.com/SgtPooki/wtfoc/commit/723c7cbca70c04063cc55e97193df33027a912a2))
* **cli:** detect embedding model mismatch on ingest ([829981c](https://github.com/SgtPooki/wtfoc/commit/829981cf3e2eb955145a876c33caf43bac38cd32))
* **cli:** pluggable embedder via --embedder flag (LM Studio support) ([844a56e](https://github.com/SgtPooki/wtfoc/commit/844a56e9043f84b65dd5b811f60909fe0749a5ab))
* **cli:** scaffold @wtfoc/cli package ([1222347](https://github.com/SgtPooki/wtfoc/commit/12223475f8723879a68cd5a8d5d02abe61622514))
* **cli:** working CLI with init, ingest, trace, query, status, verify ([c5b80e9](https://github.com/SgtPooki/wtfoc/commit/c5b80e91f5bf4ba278d9e44d14fc5c406d665b5d))
* collection provenance — identity, revisions, mount, diff ([#46](https://github.com/SgtPooki/wtfoc/issues/46)) ([b6d08a3](https://github.com/SgtPooki/wtfoc/commit/b6d08a3179b969840cdd19a2617d77dc7fd422a5))
* demo script + embedder quality warning + Ollama support prep ([e928666](https://github.com/SgtPooki/wtfoc/commit/e928666aba75fae6bb46bb5b328acad3057987da))
* global --storage flag + FocStorageBackend build fixes ([56dac45](https://github.com/SgtPooki/wtfoc/commit/56dac45694f8a350f8edbeee1c7e881ec2bb7155))
* pluggable embedder with LM Studio support + auto-detect dimensions ([6f6e06c](https://github.com/SgtPooki/wtfoc/commit/6f6e06c3b4adfc6e75709f9164af238226c32492))


### Bug Fixes

* add content field to Segment chunks for display in results ([0612b26](https://github.com/SgtPooki/wtfoc/commit/0612b26d056a037c528409d4775ffb21d59c9291))
* **cli:** friendly dimension mismatch error + suppress dtype warning ([c6078ca](https://github.com/SgtPooki/wtfoc/commit/c6078ca655209291dd897fd210f270216d3ae7cb))
* enforce no non-null assertions + no double casts ([b478266](https://github.com/SgtPooki/wtfoc/commit/b478266deedc0c7cdd4f824479240bbf4336fbaa))
* removed unsafe type casts, proper option extraction from config. ([c5b80e9](https://github.com/SgtPooki/wtfoc/commit/c5b80e91f5bf4ba278d9e44d14fc5c406d665b5d))
* standardize test scripts + fix agent-loop local-in-loop error ([d27f42f](https://github.com/SgtPooki/wtfoc/commit/d27f42f90eae036834c590da7396131d3f5eaae7))


### Refactoring

* **cli:** model-centric embedder flags instead of server-centric ([cad452e](https://github.com/SgtPooki/wtfoc/commit/cad452e04aa4e3070e17ac58ead77c8fd1abbc90))
* **common:** type-safe SourceAdapter with generic config + parseConfig ([7a92979](https://github.com/SgtPooki/wtfoc/commit/7a929798eed5a94198392075e8d276a8d9ed2034))

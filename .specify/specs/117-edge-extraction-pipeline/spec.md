# Feature Specification: Edge Extraction Beyond Regex

**Feature Branch**: `117-edge-extraction-pipeline`
**Created**: 2026-03-25
**Status**: Draft
**Input**: User description: "Edge extraction beyond regex — improving the default edge extractor from regex-only to a layered composed pipeline"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Heuristic Link Detection (Priority: P1)

As a user ingesting Slack messages, Jira tickets, and markdown documents, I want the system to automatically detect and extract connections from common link patterns (Slack message links, Jira ticket references, markdown hyperlinks) so that I get richer cross-source graphs without any additional configuration.

**Why this priority**: The existing regex extractor only handles GitHub-style references. Many teams use Slack, Jira, and markdown-heavy documentation where important connections are expressed as hyperlinks, message permalinks, or ticket keys (e.g., `PROJ-123`). This is the highest-value improvement because it requires no external services, no configuration, and immediately increases edge coverage for the most common source types.

**Independent Test**: Can be fully tested by ingesting a batch of Slack messages and markdown files containing Jira tickets and hyperlinks, then verifying that the expected edges appear in the output with appropriate confidence scores.

**Acceptance Scenarios**:

1. **Given** a Slack message containing a Slack message permalink (e.g., `https://team.slack.com/archives/C01ABC/p1234567890`), **When** the system extracts edges, **Then** a `references` edge is created linking the message to the referenced message with confidence between 0.8 and 0.9.
2. **Given** a markdown document containing a Jira ticket key (e.g., `PROJ-123`), **When** the system extracts edges, **Then** a `references` edge is created with `targetType: "jira-ticket"` and confidence between 0.8 and 0.9.
3. **Given** a markdown document containing inline hyperlinks (e.g., `[link text](https://example.com/doc)`), **When** the system extracts edges, **Then** a `references` edge is created linking to the referenced URL with confidence between 0.8 and 0.9.
4. **Given** content that contains both a GitHub `#123` reference and a Jira `PROJ-456` reference, **When** the system extracts edges, **Then** both edges are returned — the GitHub reference from the regex extractor and the Jira reference from the heuristic extractor — without duplication.

---

### User Story 2 - Code-Aware Import and Dependency Edges (Priority: P2)

As a user ingesting source code repositories, I want the system to understand import statements, dependency declarations, and symbol references so that I get accurate "depends-on" and "imports" edges between code artifacts without needing an LLM.

**Why this priority**: Code repositories are a primary source type. Understanding structural relationships (imports, dependencies, symbol references) provides high-confidence edges that are deterministic and fast. This ships before the LLM extractor and covers the most common code relationship patterns.

**Independent Test**: Can be fully tested by ingesting a code repository with known import relationships and verifying that `imports` and `depends-on` edges are created with correct source and target references.

**Acceptance Scenarios**:

1. **Given** a TypeScript file containing `import { foo } from './bar'`, **When** the system extracts edges, **Then** an `imports` edge is created from the source file to the target module with confidence between 0.95 and 1.0.
2. **Given** a Python file containing `from package.module import Class`, **When** the system extracts edges, **Then** an `imports` edge is created with correct module resolution and confidence between 0.95 and 1.0.
3. **Given** a `package.json` declaring a dependency on `@wtfoc/common`, **When** the system extracts edges, **Then** a `depends-on` edge is created linking the package to its dependency with confidence 1.0.
4. **Given** a code file in an unsupported language (no parser available), **When** the system attempts edge extraction, **Then** the code-aware extractor gracefully skips the file and the system falls back to regex-only extraction without errors.

---

### User Story 3 - LLM-Powered Semantic Edge Extraction (Priority: P3)

As a user with access to a local or cloud LLM endpoint, I want the system to optionally use an LLM to discover semantic relationships that patterns alone cannot detect (e.g., "this design doc describes the architecture for that feature," "this Slack discussion led to that PR") so that my knowledge graph captures implicit connections.

**Why this priority**: LLM extraction provides the highest breadth of edge discovery but requires external infrastructure, adds latency, and has variable reliability. It is designed as an optional enhancement that runs in the background and never blocks the core ingestion pipeline.

**Independent Test**: Can be fully tested by configuring an LLM endpoint, ingesting a batch of related artifacts (e.g., a PR and its associated Slack discussion), and verifying that semantic edges are created with appropriate confidence scores — and also by testing that ingestion completes successfully when the LLM endpoint is unavailable.

**Acceptance Scenarios**:

1. **Given** a configured LLM endpoint and a PR description that says "implements the design from the architecture doc," **When** the system extracts edges, **Then** an `implements` or `references` edge is created linking the PR to the design document with confidence between 0.3 and 0.8.
2. **Given** an LLM endpoint that is unreachable or returns errors, **When** the system attempts edge extraction, **Then** ingestion completes successfully using only regex, heuristic, and code-aware extractors — no data is lost and no errors are surfaced to the user.
3. **Given** a configured LLM endpoint and a batch of Slack messages in a thread, **When** the system extracts edges, **Then** the messages are batched together as a single context unit (thread-level batching) rather than processed individually.
4. **Given** both the LLM extractor and the regex extractor identify the same relationship (e.g., both find a reference from PR to issue), **When** edges are merged, **Then** a single deduplicated edge is produced with boosted confidence reflecting the agreement between extractors, and provenance tracking shows both sources.

---

### User Story 4 - Composable Extraction Pipeline (Priority: P1)

As a system operator, I want edge extraction to be a composable pipeline of independent extractors that are merged and deduplicated, so that I can enable or disable individual extraction layers and trust that results are consistent regardless of which extractors are active.

**Why this priority**: This is the foundational architecture that enables all other stories. Without the composite orchestrator, individual extractors cannot be combined, deduplicated, or independently toggled. This is co-P1 with heuristic detection because it is the prerequisite for layered extraction.

**Independent Test**: Can be fully tested by running the composite extractor with different combinations of enabled/disabled sub-extractors and verifying that merge, deduplication, and confidence calibration work correctly.

**Acceptance Scenarios**:

1. **Given** the regex extractor and heuristic extractor both find the same reference to an issue, **When** the composite extractor merges results, **Then** a single edge is produced with the canonical key (type, sourceId, targetType, targetId), merged evidence from both extractors, and provenance tracking both sources.
2. **Given** the user disables the LLM extractor via configuration, **When** ingestion runs, **Then** only regex, heuristic, and code-aware extractors contribute edges — the pipeline does not error or degrade.
3. **Given** multiple extractors produce edges for the same artifact batch, **When** two extractors agree on the same edge, **Then** the final confidence is boosted according to the convergence rules (higher than either individual extractor's confidence alone).
4. **Given** the extraction interface is called, **When** any extractor runs, **Then** the call is asynchronous and supports cancellation via an abort signal.

---

### User Story 5 - LLM Extractor Configuration (Priority: P3)

As a system operator, I want to configure the LLM edge extractor separately from the embedder, pointing it at any compatible chat/completion endpoint with its own model, timeout, and concurrency settings, so that I can use a different model optimized for extraction without affecting embedding.

**Why this priority**: Configuration is essential for the LLM extractor to be usable but is lower priority than the extraction logic itself. The LLM extractor is already P3; its configuration naturally follows.

**Independent Test**: Can be fully tested by providing different configuration values (URL, model, timeout, concurrency) and verifying the extractor uses them correctly, and that misconfiguration produces clear validation errors.

**Acceptance Scenarios**:

1. **Given** a configuration file with `edgeExtraction.url` set to a local endpoint, **When** the LLM extractor initializes, **Then** it connects to the specified endpoint independently of the embedder's endpoint.
2. **Given** command-line flags `--extractor-url` and `--extractor-model`, **When** the user runs ingestion, **Then** those values override the configuration file settings.
3. **Given** environment variables `WTFOC_EXTRACTOR_URL` and `WTFOC_EXTRACTOR_MODEL` are set, **When** no configuration file or CLI flags are provided, **Then** the extractor uses the environment variable values.
4. **Given** an invalid or missing extractor URL when the LLM extractor is enabled, **When** the system validates configuration, **Then** a clear error message is displayed indicating the misconfiguration.

---

### Edge Cases

- What happens when a chunk contains thousands of link-like patterns (e.g., a changelog with hundreds of issue references)? The system must handle high-volume edge output without memory exhaustion, applying reasonable limits or batching.
- What happens when the LLM returns malformed JSON or unexpected edge types? The system must fall back to raw text parsing of the response and discard edges that do not conform to the expected schema.
- What happens when the LLM endpoint is slow (exceeds the configured timeout)? The extractor must abort the request and proceed without LLM edges, logging the timeout for diagnostics.
- What happens when the same edge is found by three or more extractors? The merge logic must handle N-way convergence, not just pairwise.
- What happens when the abort signal fires mid-extraction? All in-progress extractors must respect the cancellation and return whatever edges have been collected so far.
- What happens when code files use unconventional import syntax or dynamic imports? The code-aware extractor should extract what it can and skip what it cannot parse, never blocking the pipeline.
- What happens when the LLM extractor fails mid-way through a large collection? The system must persist progress so that re-running the extractor picks up from where it left off, processing only pending and previously-failed chunks.
- What happens when chunks change between LLM extraction runs? The system must detect changed chunks and re-process them rather than serving stale edges from a previous extraction.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support an asynchronous edge extraction interface that accepts chunks and an optional abort signal and returns edges as a promise.
- **FR-002**: The system MUST provide a composite extractor that orchestrates multiple sub-extractors (regex, heuristic, code-aware, LLM), merges their results, deduplicates edges, and calibrates confidence scores.
- **FR-003**: The regex extractor MUST remain as the mandatory baseline extractor, preserving all existing behavior (GitHub issue refs, cross-repo refs, closing keywords, URL references, changed file edges).
- **FR-004**: The heuristic extractor MUST detect Slack message permalinks, Jira ticket keys (e.g., `PROJ-123`), and markdown hyperlinks, producing edges with confidence between 0.8 and 0.9.
- **FR-005**: The code-aware extractor MUST parse import statements, dependency declarations, and symbol references from source code, producing `imports` and `depends-on` edges with confidence between 0.95 and 1.0.
- **FR-006**: The code-aware extractor MUST gracefully skip files in unsupported languages without errors.
- **FR-007**: The LLM extractor MUST be optional and disabled by default, activatable per collection or globally via configuration.
- **FR-008**: The LLM extractor MUST operate in a fail-open manner — LLM failures, timeouts, or unavailability MUST never block or fail the ingestion pipeline.
- **FR-009**: The LLM extractor MUST run in the background by default, with results merged asynchronously.
- **FR-010**: The LLM extractor MUST work with any endpoint compatible with the standard chat/completion API format (supporting local inference servers, cloud providers, etc.).
- **FR-011**: The LLM extractor MUST use a strict extraction prompt with 2-4 few-shot examples and request structured output mode with fallback to raw text parsing.
- **FR-012**: The LLM extractor MUST batch inputs by artifact context (e.g., a PR and its comments together, a Slack thread together) within a 2k-6k token budget per request.
- **FR-013**: The LLM extractor configuration MUST be separate from the embedder configuration, with its own endpoint URL, model name, timeout, and concurrency settings.
- **FR-014**: The system MUST support configuration via configuration file, command-line flags (`--extractor-url`, `--extractor-model`, `--extractor-enabled`), and environment variables (`WTFOC_EXTRACTOR_URL`, `WTFOC_EXTRACTOR_MODEL`, etc.) with CLI flags taking precedence over file settings, and environment variables as the lowest-priority fallback.
- **FR-015**: The deduplication logic MUST use a canonical key composed of (type, sourceId, targetType, targetId) to identify duplicate edges across extractors.
- **FR-016**: When merging duplicate edges, the system MUST combine evidence from all contributing extractors and track provenance (which extractors produced the edge).
- **FR-017**: When multiple extractors agree on the same edge, the system MUST apply a confidence boost reflecting the convergence.
- **FR-018**: The system MUST assign confidence tiers as follows: regex explicit = 1.0, regex inferred (bare `#N` resolved via batch affinity) = 0.5, code-aware = 0.95-1.0, heuristic = 0.8-0.9, LLM explicit = 0.6-0.8, LLM inferred = 0.3-0.6. Merged confidence from multi-extractor agreement may exceed per-extractor band (capped at 1.0).
- **FR-019**: All extractors MUST respect the abort signal, stopping work and returning partial results when cancellation is requested.
- **FR-020**: The LLM extractor MUST be incremental — it MUST track which chunks have been processed and only extract edges for new or changed chunks on subsequent runs.
- **FR-021**: The LLM extractor MUST be re-runnable after failure — it MUST track per-chunk extraction status (pending, completed, failed) and on re-run only process pending and previously-failed chunks.
- **FR-022**: When re-run, the LLM extractor MUST merge newly extracted edges into the existing edge set without creating duplicates, using the same canonical deduplication key as FR-015.

### Key Entities

- **Edge**: A typed, evidence-backed connection between artifacts. Key attributes: type, sourceId, targetType, targetId, evidence, confidence. Extended with provenance tracking (which extractors contributed).
- **Extractor**: A component that analyzes chunks and produces edges. Each extractor has a name, a confidence tier, and an async extraction method.
- **Composite Extractor**: The orchestrator that runs multiple extractors, merges results, deduplicates by canonical key, calibrates confidence, and tracks provenance.
- **Extraction Configuration**: Settings for the LLM extractor including endpoint URL, model name, structured output mode preference, timeout, and concurrency limit. Separate from embedder configuration.

### Assumptions

- The existing `EdgeExtractor` interface changing from synchronous to asynchronous is an acceptable breaking change for this feature, as the interface is internal and has a small number of implementers.
- Jira ticket key patterns follow the standard format: one or more uppercase letters followed by a hyphen and one or more digits (e.g., `PROJ-123`).
- The code-aware extractor will initially support TypeScript/JavaScript, Python, and JSON-based dependency manifests (package.json, requirements.txt). Additional languages can be added incrementally.
- The LLM extraction prompt and few-shot examples will be iterated on after initial implementation based on real-world extraction quality.
- Configuration file changes (adding `edgeExtraction` section) are backwards-compatible — existing configuration files without this section continue to work with defaults (LLM disabled, other extractors enabled).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The system extracts at least 40% more edges from a representative mixed-source corpus (GitHub PRs, Slack messages, markdown docs, code repos) compared to regex-only extraction, without any additional user configuration.
- **SC-002**: All edges produced by the heuristic and code-aware extractors are verifiable against their source content — false positive rate below 5%.
- **SC-003**: Ingestion throughput with all non-LLM extractors enabled remains within 20% of regex-only ingestion throughput (i.e., the additional extractors do not significantly degrade performance).
- **SC-004**: When the LLM extractor is enabled and the endpoint is unavailable, ingestion completes successfully with zero data loss and the failure is logged.
- **SC-005**: Duplicate edges from multiple extractors are merged into a single edge 100% of the time — no duplicate edges with identical canonical keys appear in the output.
- **SC-006**: Users can configure and enable the LLM extractor in under 5 minutes using the configuration file, CLI flags, or environment variables.

## Out of Scope (v1)

- Co-occurrence detection (inferring edges from artifacts appearing in similar contexts)
- "Same domain = related" heuristic (e.g., linking all artifacts from the same GitHub org)
- Graph neural networks (GNNs) for edge prediction
- Specialized NER models for entity extraction
- Custom user-defined extractor plugins (the architecture supports it, but the plugin API is not part of v1)

# Data Model: .wtfoc.json Project Config

**Feature**: 118-project-config
**Date**: 2026-03-25

## Entities

### ProjectConfig (file-level)

The raw config object parsed from `.wtfoc.json`. All fields optional — missing file or empty `{}` yields all defaults.

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| embedder | EmbedderConfig | No | undefined | Embedding endpoint config |
| extractor | ExtractorConfig | No | undefined | LLM edge extraction config |
| ignore | string[] | No | undefined | Gitignore-style patterns, additive with built-in defaults |

### EmbedderConfig

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| url | string | No | undefined | URL or shortcut ("lmstudio", "ollama") |
| model | string | No | undefined | Model name (required if url is set) |
| key | string | No | undefined | API key for authenticated endpoints |

**Validation rules**:
- If `url` is present and not a known shortcut, must start with `http://` or `https://`
- If `url` is present, `model` must also be present (can't guess what model the server has loaded)

### ExtractorConfig

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| enabled | boolean | No | false | Must explicitly enable LLM extraction |
| url | string | No | undefined | URL or shortcut |
| model | string | No | undefined | LLM model name |
| apiKey | string | No | undefined | API key |
| timeout | number | No | 20000 | Request timeout in milliseconds |
| concurrency | number | No | 4 | Max parallel LLM requests |

**Validation rules**:
- If `enabled` is `true`, `url` and `model` are required
- `timeout` must be a positive integer
- `concurrency` must be a positive integer (1–32)

### ResolvedConfig

The final merged config after applying precedence (CLI > file > env > defaults). Not stored — computed at runtime.

| Field | Type | Always Present | Source Precedence |
|-------|------|----------------|-------------------|
| embedder.url | string \| undefined | No | CLI `--embedder-url` > file `embedder.url` > env `WTFOC_EMBEDDER_URL` |
| embedder.model | string \| undefined | No | CLI `--embedder-model` > file `embedder.model` > env `WTFOC_EMBEDDER_MODEL` |
| embedder.key | string \| undefined | No | CLI `--embedder-key` > file `embedder.key` > env `WTFOC_EMBEDDER_KEY` / `WTFOC_OPENAI_API_KEY` |
| extractor.enabled | boolean | Yes | CLI `--extractor-enabled` > file `extractor.enabled` > env `WTFOC_EXTRACTOR_ENABLED` > `false` |
| extractor.url | string \| undefined | No | CLI `--extractor-url` > file `extractor.url` > env `WTFOC_EXTRACTOR_URL` |
| extractor.model | string \| undefined | No | CLI `--extractor-model` > file `extractor.model` > env `WTFOC_EXTRACTOR_MODEL` |
| extractor.apiKey | string \| undefined | No | CLI `--extractor-key` > file `extractor.apiKey` > env `WTFOC_EXTRACTOR_API_KEY` |
| extractor.timeout | number | Yes | CLI `--extractor-timeout` > file `extractor.timeout` > env `WTFOC_EXTRACTOR_TIMEOUT_MS` > `20000` |
| extractor.concurrency | number | Yes | CLI `--extractor-concurrency` > file `extractor.concurrency` > env `WTFOC_EXTRACTOR_MAX_CONCURRENCY` > `4` |
| ignore | string[] | Yes | file `ignore` merged with built-in defaults |

## Built-in Defaults

### Default Ignore Patterns (always applied)

```
.git
node_modules
```

These are always prepended to user-specified patterns. Users can negate them with `!` if needed (though this would be unusual).

### URL Shortcuts

| Shortcut | Resolves To |
|----------|-------------|
| `lmstudio` | `http://localhost:1234/v1` |
| `ollama` | `http://localhost:11434/v1` |

## Example `.wtfoc.json`

```json
{
  "embedder": {
    "url": "lmstudio",
    "model": "nomic-embed-text"
  },
  "extractor": {
    "enabled": true,
    "url": "http://vllm.k8s.local:8000/v1",
    "model": "Qwen3-32B-AWQ",
    "timeout": 30000,
    "concurrency": 2
  },
  "ignore": [
    "dist/**",
    "*.min.js",
    "coverage/**",
    "*.log"
  ]
}
```

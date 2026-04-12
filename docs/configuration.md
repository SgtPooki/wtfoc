# Configuration

wtfoc supports project-level configuration via `.wtfoc.json` and file exclusion via `.wtfocignore`.

## `.wtfoc.json`

Create a `.wtfoc.json` file in your project root to set team/project defaults. The file is optional — all commands work without it using built-in defaults.

### Schema

```json
{
  "embedder": {
    "url": "lmstudio",
    "model": "nomic-embed-text",
    "key": "optional-api-key"
  },
  "extractor": {
    "enabled": true,
    "url": "http://vllm.k8s.local:8000/v1",
    "model": "Qwen3-32B-AWQ",
    "apiKey": "optional-api-key",
    "timeout": 20000,
    "concurrency": 4
  },
  "ignore": [
    "docs/internal/",
    "*.generated.*"
  ]
}
```

All sections are optional. Only include what you need to override.

### Embedder

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes (with model) | Endpoint URL or shortcut (`"lmstudio"`, `"ollama"`) |
| `model` | string | yes (with url) | Model name the server has loaded |
| `key` | string | no | API key for authenticated endpoints |

URL shortcuts: `"lmstudio"` resolves to `http://localhost:1234/v1`, `"ollama"` resolves to `http://localhost:11434/v1`. Any OpenAI-compatible endpoint URL is accepted.

### Extractor (LLM Edge Extraction)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | no | `false` | Enable LLM-powered edge extraction |
| `url` | string | when enabled | — | LLM endpoint URL or shortcut |
| `model` | string | when enabled | — | Model name |
| `apiKey` | string | no | — | API key |
| `timeout` | number | no | `20000` | Request timeout in ms |
| `concurrency` | number | no | `4` | Parallel extraction requests (1-32) |

When `enabled` is `true`, both `url` and `model` are required.

### Ignore

An array of gitignore-style patterns for file exclusion during ingest. These merge additively with built-in defaults and `.wtfocignore` patterns.

### Precedence

Configuration values are resolved in this order (highest wins):

```
CLI flag > .wtfoc.json > environment variable > built-in default
```

Example: if `WTFOC_EMBEDDER_URL=ollama` is set and `.wtfoc.json` has `embedder.url = "lmstudio"`, the config file wins. But `--embedder-url http://custom:8000/v1` on the CLI overrides both.

### Validation

- Invalid JSON or wrong types cause the command to **abort immediately** (fail-fast). Partial config is never applied.
- Unrecognized top-level keys produce a **warning** (possible typo) but don't abort.
- Config is searched only in the current working directory — no recursive upward search.

## `.wtfocignore`

A gitignore-style file for excluding files from repo ingestion. Place it in the repo root.

### Syntax

- Glob patterns: `*.lock`, `dist/**`, `docs/internal/`
- Comments: lines starting with `#`
- Negation: `!important.config.json` re-includes a file excluded by a broader pattern
- Directory markers: trailing `/` matches directories only

### Built-in Defaults

These patterns are always applied, even without any configuration:

- `.git`, `node_modules`
- Lock files (`*.lock`)
- Minified files (`*.min.js`, `*.min.css`)
- Source maps (`*.map`)
- Build output (`dist/`, `build/`, `out/`)
- Coverage and cache directories (`coverage/`, `.turbo/`, `__pycache__/`)

### Pattern Merging

Patterns from all sources are merged additively:

```
built-in defaults + .wtfocignore + .wtfoc.json "ignore" + --ignore CLI flags
```

All sources combine to exclude more files. Use negation patterns (`!`) to re-include specific files.

### CLI Flag

Use `--ignore <pattern>` for ad-hoc exclusions (repeatable):

```bash
wtfoc ingest repo . --ignore "*.test.*" --ignore "fixtures/"
```

## Wallet-Connected Collection Flow (wtfoc.xyz)

The hosted web UI at wtfoc.xyz supports wallet-connected collection creation:

- **Authentication**: Two-layer model — session cookie for API calls, delegated session key for FOC write operations. The server never accesses the user's wallet private key.
- **Sources**: Public GitHub repos (by `owner/repo`), public websites (HTTPS URL), HackerNews threads (by ID). Structured source identifiers are validated server-side — no arbitrary URL input.
- **SSRF hardening**: Website sources enforce HTTPS-only, block private/link-local IPs, DNS rebinding defense, content-type restrictions, rate limits per wallet and IP.
- **Privacy**: Unpromoted collections are private to the creator's wallet. Promoted collections are public by CID.
- **State persistence**: Postgres when `DATABASE_URL` is set, in-memory fallback for local dev.
- **GitHub adapter**: Direct HTTP calls to GitHub REST API (not `gh` CLI). Server-provisioned PAT for MVP; GitHub App OAuth planned for per-user rate limits.

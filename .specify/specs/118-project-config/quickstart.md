# Quickstart: .wtfoc.json Project Config

## Build Sequence

1. **`@wtfoc/common`** — Add config types (`ProjectConfig`, `EmbedderConfig`, `ExtractorConfig`, `ResolvedConfig`) and error classes (`ConfigParseError`, `ConfigValidationError`)
2. **`@wtfoc/config`** (new package) — Config loader, validator, resolver, ignore filter. Depends on `@wtfoc/common` + `ignore` npm package
3. **`@wtfoc/ingest`** — Wire ignore filter into `walkFiles()` in repo adapter. Add `@wtfoc/config` as dependency
4. **`@wtfoc/cli`** — Wire `loadProjectConfig()` + `resolveConfig()` into CLI startup. Refactor `createEmbedder()` to accept resolved config. Add `@wtfoc/config` as dependency
5. **`@wtfoc/mcp-server`** — Wire config loading into server initialization. Replace env-var-only embedder creation. Add `@wtfoc/config` as dependency

## Smoke Test

```bash
# 1. Create a .wtfoc.json in a test project
cat > /tmp/test-project/.wtfoc.json << 'EOF'
{
  "embedder": {
    "url": "lmstudio",
    "model": "nomic-embed-text"
  },
  "ignore": ["*.log", "dist/**"]
}
EOF

# 2. Verify config is loaded (ingest should use lmstudio endpoint)
cd /tmp/test-project
wtfoc ingest --source ./src

# 3. Verify precedence (CLI flag should override config)
wtfoc ingest --source ./src --embedder-url ollama

# 4. Verify validation error
echo '{ "embedder": { "url": 123 } }' > .wtfoc.json
wtfoc ingest --source ./src
# Expected: ConfigValidationError with field name, expected type, actual type

# 5. Verify unknown key warning
echo '{ "enbedder": {} }' > .wtfoc.json
wtfoc ingest --source ./src
# Expected: warning about unrecognized key "enbedder"
```

## Key Files to Create

| File | Purpose |
|------|---------|
| `packages/common/src/config-types.ts` | Config interfaces (ProjectConfig, etc.) |
| `packages/common/src/errors.ts` | Add ConfigParseError, ConfigValidationError |
| `packages/config/package.json` | New package manifest |
| `packages/config/tsconfig.json` | TypeScript config with project refs |
| `packages/config/src/index.ts` | Public API exports |
| `packages/config/src/loader.ts` | `loadProjectConfig()` — read + parse + validate |
| `packages/config/src/resolver.ts` | `resolveConfig()` — precedence merge |
| `packages/config/src/shortcuts.ts` | `resolveUrlShortcut()` — URL shortcut map |
| `packages/config/src/ignore.ts` | `createIgnoreFilter()` — gitignore pattern filter |
| `packages/config/src/validator.ts` | Schema validation with clear error messages |

## Key Files to Modify

| File | Change |
|------|--------|
| `packages/cli/src/helpers.ts` | Refactor `createEmbedder()` to accept ResolvedConfig; remove inline URL shortcuts |
| `packages/cli/src/cli.ts` | Load config at startup, pass to commands |
| `packages/mcp-server/src/helpers.ts` | Refactor `createEmbedder()` to use config; remove inline URL shortcuts |
| `packages/mcp-server/src/index.ts` | Load config at startup |
| `packages/ingest/src/adapters/repo/chunking.ts` | Accept ignore filter in `walkFiles()` |
| `pnpm-workspace.yaml` | Add `packages/config` |
| `tsconfig.json` (root) | Add project reference for `packages/config` |

/**
 * Contract for the config loading and resolution API.
 *
 * Package: @wtfoc/config (has I/O — reads .wtfoc.json from filesystem)
 */

import type {
	EmbedderConfig,
	ExtractorConfig,
	ProjectConfig,
	ResolvedConfig,
	ResolvedEmbedderConfig,
	ResolvedExtractorConfig,
} from "./config-types.js";

// ── Config loading ────────────────────────────────────────────────

/**
 * Read and validate .wtfoc.json from the given directory.
 *
 * @param cwd - Directory to search (defaults to process.cwd())
 * @returns Validated ProjectConfig, or undefined if no config file exists
 * @throws ConfigParseError - Invalid JSON
 * @throws ConfigValidationError - Schema validation failure (fail fast)
 */
export declare function loadProjectConfig(
	cwd?: string,
): ProjectConfig | undefined;

// ── Config resolution (precedence merge) ──────────────────────────

/**
 * Sources for config resolution, in precedence order.
 * Each source provides partial config — undefined means "not specified at this level."
 */
export interface ConfigSources {
	/** CLI flags (highest precedence) */
	cli?: {
		embedderUrl?: string;
		embedderModel?: string;
		embedderKey?: string;
		extractorEnabled?: boolean;
		extractorUrl?: string;
		extractorModel?: string;
		extractorKey?: string;
		extractorTimeout?: number;
		extractorConcurrency?: number;
	};
	/** .wtfoc.json file config */
	file?: ProjectConfig;
	/** Environment variables (read internally from process.env) */
	// Env vars are read by resolveConfig itself — no need to pass them in.
}

/**
 * Merge config from all sources with precedence: CLI > file > env > defaults.
 *
 * URL shortcuts are resolved at this stage.
 */
export declare function resolveConfig(sources: ConfigSources): ResolvedConfig;

// ── URL shortcuts ─────────────────────────────────────────────────

/**
 * Resolve a URL shortcut to its full URL.
 * Returns the input unchanged if it's not a known shortcut.
 */
export declare function resolveUrlShortcut(url: string): string;

// ── Ignore patterns ───────────────────────────────────────────────

/**
 * Create a filter function from ignore patterns.
 * Merges user patterns with built-in defaults (.git, node_modules).
 *
 * @param userPatterns - Patterns from .wtfoc.json ignore array
 * @returns Function that returns true if a path should be INCLUDED (not ignored)
 */
export declare function createIgnoreFilter(
	userPatterns?: string[],
): (path: string) => boolean;

// ── Error types ───────────────────────────────────────────────────

/**
 * Package: @wtfoc/common (alongside existing error classes)
 */

// ConfigParseError — code: "CONFIG_PARSE"
// Thrown when .wtfoc.json contains invalid JSON.
// Context: { filePath: string; parseError: string }

// ConfigValidationError — code: "CONFIG_VALIDATION"
// Thrown when .wtfoc.json has valid JSON but fails schema validation.
// Context: { filePath: string; field: string; expected: string; got: string }

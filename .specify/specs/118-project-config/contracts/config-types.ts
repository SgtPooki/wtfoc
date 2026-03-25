/**
 * Contract types for .wtfoc.json project configuration.
 *
 * These types define the shape of the config file and the resolved
 * configuration after applying precedence rules.
 *
 * Package: @wtfoc/common (interfaces only, no I/O)
 */

// ── File-level config (raw from .wtfoc.json) ──────────────────────

export interface ProjectConfig {
	embedder?: EmbedderConfig;
	extractor?: ExtractorConfig;
	ignore?: string[];
}

export interface EmbedderConfig {
	url?: string;
	model?: string;
	key?: string;
}

export interface ExtractorConfig {
	enabled?: boolean;
	url?: string;
	model?: string;
	apiKey?: string;
	timeout?: number;
	concurrency?: number;
}

// ── Resolved config (after precedence merge) ──────────────────────

export interface ResolvedEmbedderConfig {
	url: string | undefined;
	model: string | undefined;
	key: string | undefined;
}

export interface ResolvedExtractorConfig {
	enabled: boolean;
	url: string | undefined;
	model: string | undefined;
	apiKey: string | undefined;
	timeout: number;
	concurrency: number;
}

export interface ResolvedConfig {
	embedder: ResolvedEmbedderConfig;
	extractor: ResolvedExtractorConfig;
	ignore: string[];
}

// ── URL shortcuts ─────────────────────────────────────────────────

export const URL_SHORTCUTS: Readonly<Record<string, string>> = {
	lmstudio: "http://localhost:1234/v1",
	ollama: "http://localhost:11434/v1",
};

export const BUILTIN_IGNORE_PATTERNS: readonly string[] = [
	".git",
	"node_modules",
];

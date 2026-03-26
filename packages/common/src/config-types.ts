/** Pooling strategy for local transformer models */
export type PoolingStrategy = "mean" | "cls" | "last_token";

export const VALID_POOLING_STRATEGIES: readonly PoolingStrategy[] = ["mean", "cls", "last_token"];

/** Optional prefix formatter for query/document embedding asymmetry */
export interface PrefixFormatter {
	query: string;
	document: string;
}

/**
 * Named embedder profile that bundles model + pooling + prefix + dimensions.
 * Can be referenced by name in config or selected via env var.
 */
export interface EmbedderProfile {
	model: string;
	dimensions?: number;
	pooling?: PoolingStrategy;
	prefix?: PrefixFormatter;
}

/** Raw config from .wtfoc.json — all fields optional */
export interface ProjectConfig {
	embedder?: EmbedderConfig;
	extractor?: ExtractorConfig;
	ignore?: string[];
}

export interface EmbedderConfig {
	url?: string;
	model?: string;
	key?: string;
	profile?: string;
	profiles?: Record<string, EmbedderProfile>;
	dimensions?: number;
	pooling?: PoolingStrategy;
	prefix?: PrefixFormatter;
}

export interface ExtractorConfig {
	enabled?: boolean;
	url?: string;
	model?: string;
	apiKey?: string;
	timeout?: number;
	concurrency?: number;
}

/** Resolved config after precedence merge — filled with defaults */
export interface ResolvedEmbedderConfig {
	url: string | undefined;
	model: string | undefined;
	key: string | undefined;
	profile: string | undefined;
	profiles: Record<string, EmbedderProfile>;
	dimensions: number | undefined;
	pooling: PoolingStrategy | undefined;
	prefix: PrefixFormatter | undefined;
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

export const URL_SHORTCUTS: Readonly<Record<string, string>> = {
	lmstudio: "http://localhost:1234/v1",
	ollama: "http://localhost:11434/v1",
};

export const BUILTIN_IGNORE_PATTERNS: readonly string[] = [
	".git",
	"node_modules",
	"dist/",
	"build/",
	"out/",
	"coverage/",
	".next/",
	".turbo/",
	"__pycache__/",
	"*.lock",
	"package-lock.json",
	"pnpm-lock.yaml",
	"*.min.js",
	"*.min.css",
	"*.map",
	// Common test files and fixtures ignored by default
	"*.test.*",
	"*.spec.*",
	"*.stories.*",
	"__tests__/",
	"__fixtures__/",
	"__mocks__/",
	"test/",
	"tests/",
	"fixtures/",
	"spec/",
];

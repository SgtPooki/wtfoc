import type { ProjectConfig } from "@wtfoc/common";
import { ConfigValidationError, URL_SHORTCUTS, VALID_POOLING_STRATEGIES } from "@wtfoc/common";

const KNOWN_TOP_LEVEL_KEYS = new Set(["embedder", "extractor", "ignore"]);
const KNOWN_SHORTCUTS = new Set(Object.keys(URL_SHORTCUTS));

function isValidUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://") || KNOWN_SHORTCUTS.has(value);
}

export function validateProjectConfig(raw: unknown, filePath: string): ProjectConfig {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new ConfigValidationError(filePath, "(root)", "an object", typeof raw);
	}

	const obj = raw as Record<string, unknown>;

	for (const key of Object.keys(obj)) {
		if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
			process.stderr.write(
				`Warning: unrecognized key "${key}" in ${filePath}. Known keys: ${[...KNOWN_TOP_LEVEL_KEYS].join(", ")}\n`,
			);
		}
	}

	if (obj.embedder !== undefined) {
		validateEmbedderConfig(obj.embedder, filePath);
	}

	if (obj.extractor !== undefined) {
		validateExtractorConfig(obj.extractor, filePath);
	}

	if (obj.ignore !== undefined) {
		validateIgnoreConfig(obj.ignore, filePath);
	}

	return obj as ProjectConfig;
}

function validateEmbedderConfig(value: unknown, filePath: string): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ConfigValidationError(filePath, "embedder", "an object", typeof value);
	}
	const embedder = value as Record<string, unknown>;

	if (embedder.url !== undefined) {
		if (typeof embedder.url !== "string") {
			throw new ConfigValidationError(filePath, "embedder.url", "a string", typeof embedder.url);
		}
		if (!isValidUrl(embedder.url)) {
			throw new ConfigValidationError(
				filePath,
				"embedder.url",
				"a URL (http:// or https://) or shortcut (lmstudio, ollama)",
				`"${embedder.url}"`,
			);
		}
		if (!embedder.model) {
			throw new ConfigValidationError(
				filePath,
				"embedder.model",
				"a string (required when embedder.url is set)",
				"undefined",
			);
		}
	}

	if (embedder.model !== undefined && typeof embedder.model !== "string") {
		throw new ConfigValidationError(filePath, "embedder.model", "a string", typeof embedder.model);
	}

	if (embedder.key !== undefined && typeof embedder.key !== "string") {
		throw new ConfigValidationError(filePath, "embedder.key", "a string", typeof embedder.key);
	}

	if (embedder.profile !== undefined && typeof embedder.profile !== "string") {
		throw new ConfigValidationError(
			filePath,
			"embedder.profile",
			"a string",
			typeof embedder.profile,
		);
	}

	if (embedder.profiles !== undefined) {
		if (
			typeof embedder.profiles !== "object" ||
			embedder.profiles === null ||
			Array.isArray(embedder.profiles)
		) {
			throw new ConfigValidationError(
				filePath,
				"embedder.profiles",
				"an object",
				typeof embedder.profiles,
			);
		}
		for (const [name, profile] of Object.entries(embedder.profiles as Record<string, unknown>)) {
			validateEmbedderProfile(profile, `embedder.profiles.${name}`, filePath);
		}
	}

	if (embedder.profile !== undefined && embedder.profiles !== undefined) {
		const profiles = embedder.profiles as Record<string, unknown>;
		if (!((embedder.profile as string) in profiles)) {
			throw new ConfigValidationError(
				filePath,
				"embedder.profile",
				`one of: ${Object.keys(profiles).join(", ")}`,
				`"${embedder.profile}"`,
			);
		}
	}

	if (embedder.dimensions !== undefined) {
		if (
			typeof embedder.dimensions !== "number" ||
			embedder.dimensions <= 0 ||
			!Number.isInteger(embedder.dimensions)
		) {
			throw new ConfigValidationError(
				filePath,
				"embedder.dimensions",
				"a positive integer",
				String(embedder.dimensions),
			);
		}
	}

	if (embedder.pooling !== undefined) {
		if (
			typeof embedder.pooling !== "string" ||
			!VALID_POOLING_STRATEGIES.includes(embedder.pooling as never)
		) {
			throw new ConfigValidationError(
				filePath,
				"embedder.pooling",
				`one of: ${VALID_POOLING_STRATEGIES.join(", ")}`,
				`"${embedder.pooling}"`,
			);
		}
	}

	if (embedder.prefix !== undefined) {
		if (
			typeof embedder.prefix !== "object" ||
			embedder.prefix === null ||
			Array.isArray(embedder.prefix)
		) {
			throw new ConfigValidationError(
				filePath,
				"embedder.prefix",
				"an object with query/document strings",
				typeof embedder.prefix,
			);
		}
		const prefix = embedder.prefix as Record<string, unknown>;
		if (typeof prefix.query !== "string") {
			throw new ConfigValidationError(
				filePath,
				"embedder.prefix.query",
				"a string",
				typeof prefix.query,
			);
		}
		if (typeof prefix.document !== "string") {
			throw new ConfigValidationError(
				filePath,
				"embedder.prefix.document",
				"a string",
				typeof prefix.document,
			);
		}
	}
}

function validateEmbedderProfile(value: unknown, path: string, filePath: string): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ConfigValidationError(filePath, path, "an object", typeof value);
	}
	const profile = value as Record<string, unknown>;
	if (typeof profile.model !== "string") {
		throw new ConfigValidationError(
			filePath,
			`${path}.model`,
			"a string (required)",
			typeof profile.model,
		);
	}
	if (profile.dimensions !== undefined) {
		if (
			typeof profile.dimensions !== "number" ||
			profile.dimensions <= 0 ||
			!Number.isInteger(profile.dimensions)
		) {
			throw new ConfigValidationError(
				filePath,
				`${path}.dimensions`,
				"a positive integer",
				String(profile.dimensions),
			);
		}
	}
	if (profile.pooling !== undefined) {
		if (
			typeof profile.pooling !== "string" ||
			!VALID_POOLING_STRATEGIES.includes(profile.pooling as never)
		) {
			throw new ConfigValidationError(
				filePath,
				`${path}.pooling`,
				`one of: ${VALID_POOLING_STRATEGIES.join(", ")}`,
				`"${profile.pooling}"`,
			);
		}
	}
	if (profile.prefix !== undefined) {
		if (
			typeof profile.prefix !== "object" ||
			profile.prefix === null ||
			Array.isArray(profile.prefix)
		) {
			throw new ConfigValidationError(
				filePath,
				`${path}.prefix`,
				"an object with query/document strings",
				typeof profile.prefix,
			);
		}
		const prefix = profile.prefix as Record<string, unknown>;
		if (typeof prefix.query !== "string") {
			throw new ConfigValidationError(
				filePath,
				`${path}.prefix.query`,
				"a string",
				typeof prefix.query,
			);
		}
		if (typeof prefix.document !== "string") {
			throw new ConfigValidationError(
				filePath,
				`${path}.prefix.document`,
				"a string",
				typeof prefix.document,
			);
		}
	}
}

function validateExtractorConfig(value: unknown, filePath: string): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ConfigValidationError(filePath, "extractor", "an object", typeof value);
	}
	const extractor = value as Record<string, unknown>;

	if (extractor.enabled !== undefined && typeof extractor.enabled !== "boolean") {
		throw new ConfigValidationError(
			filePath,
			"extractor.enabled",
			"a boolean",
			typeof extractor.enabled,
		);
	}

	if (extractor.url !== undefined) {
		if (typeof extractor.url !== "string") {
			throw new ConfigValidationError(filePath, "extractor.url", "a string", typeof extractor.url);
		}
		if (!isValidUrl(extractor.url)) {
			throw new ConfigValidationError(
				filePath,
				"extractor.url",
				"a URL (http:// or https://) or shortcut (lmstudio, ollama)",
				`"${extractor.url}"`,
			);
		}
	}

	if (extractor.model !== undefined && typeof extractor.model !== "string") {
		throw new ConfigValidationError(
			filePath,
			"extractor.model",
			"a string",
			typeof extractor.model,
		);
	}

	if (extractor.apiKey !== undefined && typeof extractor.apiKey !== "string") {
		throw new ConfigValidationError(
			filePath,
			"extractor.apiKey",
			"a string",
			typeof extractor.apiKey,
		);
	}

	if (extractor.timeout !== undefined) {
		if (
			typeof extractor.timeout !== "number" ||
			extractor.timeout <= 0 ||
			!Number.isInteger(extractor.timeout)
		) {
			throw new ConfigValidationError(
				filePath,
				"extractor.timeout",
				"a positive integer",
				String(extractor.timeout),
			);
		}
	}

	if (extractor.concurrency !== undefined) {
		if (
			typeof extractor.concurrency !== "number" ||
			extractor.concurrency < 1 ||
			extractor.concurrency > 32 ||
			!Number.isInteger(extractor.concurrency)
		) {
			throw new ConfigValidationError(
				filePath,
				"extractor.concurrency",
				"a positive integer (1-32)",
				String(extractor.concurrency),
			);
		}
	}

	if (extractor.enabled === true) {
		if (!extractor.url) {
			throw new ConfigValidationError(
				filePath,
				"extractor.url",
				"a string (required when extractor.enabled is true)",
				"undefined",
			);
		}
		if (!extractor.model) {
			throw new ConfigValidationError(
				filePath,
				"extractor.model",
				"a string (required when extractor.enabled is true)",
				"undefined",
			);
		}
	}
}

function validateIgnoreConfig(value: unknown, filePath: string): void {
	if (!Array.isArray(value)) {
		throw new ConfigValidationError(filePath, "ignore", "an array of strings", typeof value);
	}
	for (let i = 0; i < value.length; i++) {
		if (typeof value[i] !== "string") {
			throw new ConfigValidationError(filePath, `ignore[${i}]`, "a string", typeof value[i]);
		}
	}
}

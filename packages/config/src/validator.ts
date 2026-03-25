import type { ProjectConfig } from "@wtfoc/common";
import { ConfigValidationError } from "@wtfoc/common";

const KNOWN_TOP_LEVEL_KEYS = new Set(["embedder", "extractor", "ignore"]);

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

	if (extractor.url !== undefined && typeof extractor.url !== "string") {
		throw new ConfigValidationError(filePath, "extractor.url", "a string", typeof extractor.url);
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

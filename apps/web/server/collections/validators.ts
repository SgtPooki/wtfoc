import type { SourceType } from "../db/index.js";

const GITHUB_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const HACKERNEWS_ID_RE = /^\d+$/;
const MAX_SOURCES_PER_COLLECTION = 10;
const MAX_NAME_LENGTH = 128;
const NAME_RE = /^[a-zA-Z0-9_-]+$/;

export interface ValidatedSource {
	sourceType: SourceType;
	identifier: string;
}

export interface ValidationResult {
	valid: boolean;
	sources: ValidatedSource[];
	errors: string[];
}

export function validateCollectionName(name: string): string | null {
	if (!name || name.length === 0) return "Collection name is required";
	if (name.length > MAX_NAME_LENGTH) return `Collection name must be ${MAX_NAME_LENGTH} characters or fewer`;
	if (!NAME_RE.test(name)) return "Collection name must contain only letters, numbers, hyphens, and underscores";
	return null;
}

export function validateSources(
	sources: Array<{ type?: string; identifier?: string }>,
): ValidationResult {
	const errors: string[] = [];
	const validated: ValidatedSource[] = [];

	if (!sources || sources.length === 0) {
		return { valid: false, sources: [], errors: ["At least one source is required"] };
	}

	if (sources.length > MAX_SOURCES_PER_COLLECTION) {
		return {
			valid: false,
			sources: [],
			errors: [`Maximum ${MAX_SOURCES_PER_COLLECTION} sources per collection`],
		};
	}

	for (let i = 0; i < sources.length; i++) {
		const source = sources[i];
		if (!source) continue;
		const idx = i + 1;

		if (!source.type || !source.identifier) {
			errors.push(`Source ${idx}: type and identifier are required`);
			continue;
		}

		const type = source.type as SourceType;
		const id = source.identifier.trim();

		switch (type) {
			case "github":
				if (!GITHUB_REPO_RE.test(id)) {
					errors.push(`Source ${idx}: GitHub identifier must be "owner/repo" format`);
				} else {
					validated.push({ sourceType: "github", identifier: id });
				}
				break;

			case "website": {
				try {
					const url = new URL(id);
					if (url.protocol !== "https:") {
						errors.push(`Source ${idx}: Website URL must use HTTPS`);
					} else {
						validated.push({ sourceType: "website", identifier: id });
					}
				} catch {
					errors.push(`Source ${idx}: Invalid website URL`);
				}
				break;
			}

			case "hackernews":
				if (!HACKERNEWS_ID_RE.test(id)) {
					errors.push(`Source ${idx}: HackerNews identifier must be a numeric thread ID`);
				} else {
					validated.push({ sourceType: "hackernews", identifier: id });
				}
				break;

			default:
				errors.push(`Source ${idx}: Unknown source type "${source.type}". Supported: github, website, hackernews`);
		}
	}

	return {
		valid: errors.length === 0 && validated.length > 0,
		sources: validated,
		errors,
	};
}

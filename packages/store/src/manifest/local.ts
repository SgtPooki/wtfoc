import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { CollectionHead, ManifestStore, StoredHead } from "@wtfoc/common";
import { ManifestConflictError, WtfocError } from "@wtfoc/common";
import { validateManifestSchema } from "../schema.js";

/**
 * Pattern matching manifest files: valid collection name followed by .json.
 * Must match the same character set as VALID_COLLECTION_NAME.
 * Excludes sidecar files like {name}.ingest-cursors.json, {name}.document-catalog.json, etc.
 */
const MANIFEST_FILE_PATTERN = /^[a-zA-Z0-9_-]+\.json$/;

/**
 * Valid collection name pattern: alphanumeric, hyphens, underscores.
 * No dots allowed — dots are used to separate collection names from sidecar suffixes.
 */
const VALID_COLLECTION_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate a collection name. Throws if the name contains dots or other
 * characters that would create ambiguity with sidecar file naming.
 */
export function validateCollectionName(name: string): void {
	if (!name || !VALID_COLLECTION_NAME.test(name)) {
		throw new WtfocError(
			`Invalid collection name "${name}": must contain only letters, numbers, hyphens, and underscores (1-128 chars, no dots)`,
			"COLLECTION_INVALID_NAME",
			{ projectName: name },
		);
	}
	if (name.length > 128) {
		throw new WtfocError(
			`Collection name too long (${name.length} chars): max 128 characters`,
			"COLLECTION_INVALID_NAME",
			{ projectName: name },
		);
	}
}

/**
 * Local filesystem manifest store. Persists head manifests as JSON files.
 * Conflict detection via content-hash-based headId.
 *
 * File layout: `{manifestDir}/{projectName}.json`
 * headId = SHA-256 of the serialized manifest JSON.
 */
export class LocalManifestStore implements ManifestStore {
	readonly dir: string;

	constructor(manifestDir: string) {
		this.dir = manifestDir;
	}

	async getHead(projectName: string): Promise<StoredHead | null> {
		let data: string;
		try {
			data = await readFile(this.filePath(projectName), "utf-8");
		} catch {
			return null;
		}
		try {
			const parsed: unknown = JSON.parse(data);
			const manifest = validateManifestSchema(parsed);
			const headId = this.computeHeadId(data);
			return { headId, manifest };
		} catch {
			// File exists but is not a valid manifest (corrupt, sidecar, etc.)
			return null;
		}
	}

	async putHead(
		projectName: string,
		manifest: CollectionHead,
		prevHeadId: string | null,
	): Promise<StoredHead> {
		const current = await this.getHead(projectName).catch(() => null);
		const currentHeadId = current?.headId ?? null;

		if (prevHeadId !== currentHeadId) {
			throw new ManifestConflictError(prevHeadId, currentHeadId);
		}

		await mkdir(this.dir, { recursive: true });
		const serialized = JSON.stringify(manifest, null, "\t");
		await writeFile(this.filePath(projectName), serialized, "utf-8");

		const newHeadId = this.computeHeadId(serialized);
		return { headId: newHeadId, manifest };
	}

	async listProjects(): Promise<string[]> {
		try {
			const files = await readdir(this.dir);
			// Only match base manifest files: {name}.json where name contains no dots.
			// Sidecar files (cursors, catalog, overlay, etc.) all have multi-segment
			// suffixes like .ingest-cursors.json, so they contain at least one dot
			// before the .json extension.
			return files
				.filter((f) => MANIFEST_FILE_PATTERN.test(f))
				.map((f) => f.replace(/\.json$/, ""));
		} catch {
			return [];
		}
	}

	private filePath(projectName: string): string {
		validateCollectionName(projectName);
		const base = resolve(this.dir);
		const resolved = resolve(base, `${projectName}.json`);
		const rel = relative(base, resolved);
		if (rel.startsWith("..") || isAbsolute(rel)) {
			throw new WtfocError("Invalid collection name", "COLLECTION_INVALID_NAME", {
				projectName,
			});
		}
		return resolved;
	}

	private computeHeadId(serialized: string): string {
		return createHash("sha256").update(serialized).digest("hex");
	}
}

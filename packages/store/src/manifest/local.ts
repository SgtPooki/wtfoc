import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { CollectionHead, ManifestStore, StoredHead } from "@wtfoc/common";
import { ManifestConflictError, WtfocError } from "@wtfoc/common";
import { validateManifestSchema } from "../schema.js";

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
		const parsed: unknown = JSON.parse(data);
		const manifest = validateManifestSchema(parsed);
		const headId = this.computeHeadId(data);
		return { headId, manifest };
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
			return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
		} catch {
			return [];
		}
	}

	private filePath(projectName: string): string {
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

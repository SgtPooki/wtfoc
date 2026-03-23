import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CollectionHead, ManifestStore, StoredHead } from "@wtfoc/common";
import { ManifestConflictError } from "@wtfoc/common";

/**
 * Local filesystem manifest store. Persists head manifests as JSON files.
 * Conflict detection via content-hash-based headId.
 *
 * File layout: `{manifestDir}/{projectName}.json`
 * headId = SHA-256 of the serialized manifest JSON.
 */
export class LocalManifestStore implements ManifestStore {
	constructor(private readonly manifestDir: string) {}

	async getHead(projectName: string): Promise<StoredHead | null> {
		try {
			const data = await readFile(this.filePath(projectName), "utf-8");
			const manifest = JSON.parse(data) as CollectionHead;
			const headId = this.computeHeadId(data);
			return { headId, manifest };
		} catch {
			return null;
		}
	}

	async putHead(
		projectName: string,
		manifest: CollectionHead,
		prevHeadId: string | null,
	): Promise<StoredHead> {
		const current = await this.getHead(projectName);
		const currentHeadId = current?.headId ?? null;

		if (prevHeadId !== currentHeadId) {
			throw new ManifestConflictError(prevHeadId, currentHeadId);
		}

		await mkdir(this.manifestDir, { recursive: true });
		const serialized = JSON.stringify(manifest, null, "\t");
		await writeFile(this.filePath(projectName), serialized, "utf-8");

		const newHeadId = this.computeHeadId(serialized);
		return { headId: newHeadId, manifest };
	}

	async listProjects(): Promise<string[]> {
		try {
			const files = await readdir(this.manifestDir);
			return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
		} catch {
			return [];
		}
	}

	private filePath(projectName: string): string {
		return join(this.manifestDir, `${projectName}.json`);
	}

	private computeHeadId(serialized: string): string {
		return createHash("sha256").update(serialized).digest("hex");
	}
}

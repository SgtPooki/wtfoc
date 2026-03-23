import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StorageNotFoundError } from "@wtfoc/common";
import type { StorageBackend, StorageResult } from "@wtfoc/common";

/**
 * Local filesystem storage backend. No wallet, no network.
 * Stores blobs as files named by content SHA-256 hash.
 * `id` is the hex-encoded hash — durable across process restarts.
 */
export class LocalStorageBackend implements StorageBackend {
	constructor(private readonly dataDir: string) {}

	async upload(
		data: Uint8Array,
		_metadata?: Record<string, string>,
		signal?: AbortSignal,
	): Promise<StorageResult> {
		signal?.throwIfAborted();
		await mkdir(this.dataDir, { recursive: true });
		const hash = createHash("sha256").update(data).digest("hex");
		const filePath = join(this.dataDir, hash);
		await writeFile(filePath, data);
		return { id: hash };
	}

	async download(id: string, signal?: AbortSignal): Promise<Uint8Array> {
		signal?.throwIfAborted();
		const filePath = join(this.dataDir, id);
		try {
			return await readFile(filePath);
		} catch (cause) {
			throw new StorageNotFoundError(id, "local");
		}
	}

	async verify(id: string, signal?: AbortSignal): Promise<{ exists: boolean; size: number }> {
		signal?.throwIfAborted();
		try {
			const info = await stat(join(this.dataDir, id));
			return { exists: true, size: info.size };
		} catch {
			return { exists: false, size: 0 };
		}
	}
}

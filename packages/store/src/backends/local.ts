import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { StorageBackend, StorageResult } from "@wtfoc/common";
import { StorageNotFoundError, WtfocError } from "@wtfoc/common";

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
		const filePath = this.safePath(id);
		try {
			return await readFile(filePath);
		} catch (_cause) {
			throw new StorageNotFoundError(id, "local");
		}
	}

	async verify(id: string, signal?: AbortSignal): Promise<{ exists: boolean; size: number }> {
		signal?.throwIfAborted();
		try {
			const info = await stat(this.safePath(id));
			return { exists: true, size: info.size };
		} catch {
			return { exists: false, size: 0 };
		}
	}

	private safePath(id: string): string {
		const base = resolve(this.dataDir);
		const resolved = resolve(base, id);
		const rel = relative(base, resolved);
		if (rel.startsWith("..") || isAbsolute(rel)) {
			throw new WtfocError("Invalid storage ID", "STORAGE_INVALID_ID", { id });
		}
		return resolved;
	}
}

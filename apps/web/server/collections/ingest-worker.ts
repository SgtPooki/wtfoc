/**
 * Async ingestion worker: processes sources for a collection in the background.
 * Enforces max 10 concurrent ingestion jobs (SC-006).
 */
import type { Chunk } from "@wtfoc/common";
import type { Repository, Source } from "../db/index.js";

const MAX_CONCURRENT_JOBS = 10;
let activeJobs = 0;
const jobQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
	if (activeJobs < MAX_CONCURRENT_JOBS) {
		activeJobs++;
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		jobQueue.push(() => {
			activeJobs++;
			resolve();
		});
	});
}

function releaseSlot(): void {
	activeJobs--;
	const next = jobQueue.shift();
	if (next) next();
}

export async function startIngestion(
	collectionId: string,
	sources: Source[],
	repo: Repository,
	signal?: AbortSignal,
): Promise<void> {
	await acquireSlot();
	try {
		await repo.updateCollectionStatus(collectionId, "ingesting");

		let allSucceeded = true;
		let anySucceeded = false;

		for (const source of sources) {
			if (signal?.aborted) break;

			try {
				await repo.updateSourceStatus(source.id, "ingesting");
				const chunks = await ingestSource(source, signal);
				await repo.updateSourceStatus(source.id, "complete", { chunkCount: chunks.length });
				anySucceeded = true;
			} catch (err) {
				allSucceeded = false;
				const message = err instanceof Error ? err.message : String(err);
				await repo.updateSourceStatus(source.id, "failed", { errorMessage: message });
			}
		}

		if (allSucceeded) {
			await repo.updateCollectionStatus(collectionId, "ready");
		} else if (anySucceeded) {
			await repo.updateCollectionStatus(collectionId, "ready");
		} else {
			await repo.updateCollectionStatus(collectionId, "ingestion_failed");
		}
	} catch (err) {
		console.error(`[ingest-worker] Collection ${collectionId} failed:`, err);
		try {
			await repo.updateCollectionStatus(collectionId, "ingestion_failed");
		} catch {
			// Best effort
		}
	} finally {
		releaseSlot();
	}
}

async function ingestSource(source: Source, signal?: AbortSignal): Promise<Chunk[]> {
	const chunks: Chunk[] = [];

	switch (source.sourceType) {
		case "github": {
			const { GitHubAdapter } = await import("@wtfoc/ingest");
			const { createHttpExecFn } = await import(
				"@wtfoc/ingest/adapters/github/http-transport"
			);
			const execFn = createHttpExecFn();
			const adapter = new GitHubAdapter(execFn);
			const [owner, repo] = source.identifier.split("/");
			if (!owner || !repo) throw new Error(`Invalid GitHub identifier: ${source.identifier}`);

			for await (const chunk of adapter.ingest({ owner, repo }, signal)) {
				chunks.push(chunk);
			}
			break;
		}

		case "website": {
			// Import dynamically to avoid bundling crawlee when not needed
			const { getAdapter } = await import("@wtfoc/ingest");
			const adapter = getAdapter("website");
			if (!adapter) throw new Error("Website adapter not available");

			for await (const chunk of adapter.ingest({ url: source.identifier, maxPages: 50 }, signal)) {
				chunks.push(chunk);
			}
			break;
		}

		case "hackernews": {
			const { getAdapter } = await import("@wtfoc/ingest");
			const adapter = getAdapter("hackernews");
			if (!adapter) throw new Error("HackerNews adapter not available");

			for await (const chunk of adapter.ingest({ threadId: source.identifier }, signal)) {
				chunks.push(chunk);
			}
			break;
		}

		default:
			throw new Error(`Unsupported source type: ${source.sourceType}`);
	}

	return chunks;
}

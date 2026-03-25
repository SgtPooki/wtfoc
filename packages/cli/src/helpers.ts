import type { CollectionHead, Embedder, Segment, VectorEntry, VectorIndex } from "@wtfoc/common";
import { InMemoryVectorIndex, OpenAIEmbedder, TransformersEmbedder } from "@wtfoc/search";
import { createStore } from "@wtfoc/store";
import type { Command } from "commander";
import type { OutputFormat } from "./output.js";

export interface EmbedderOpts {
	embedder?: string;
	embedderUrl?: string;
	embedderKey?: string;
	embedderModel?: string;
}

export interface LoadedCollection {
	vectorIndex: VectorIndex;
	segments: Segment[];
}

export function parseSinceDuration(duration: string): string {
	const match = duration.match(/^(\d+)([dh])$/);
	if (!match?.[1] || !match[2]) {
		console.error(
			`Invalid --since format: "${duration}". Use <number>d (days) or <number>h (hours). Example: 90d`,
		);
		process.exit(2);
	}
	const value = Number.parseInt(match[1], 10);
	const unit = match[2];
	const now = new Date();
	if (unit === "d") now.setDate(now.getDate() - value);
	else if (unit === "h") now.setHours(now.getHours() - value);
	return now.toISOString();
}

export function withEmbedderOptions<T extends Command>(cmd: T): T {
	return cmd
		.option(
			"--embedder <type>",
			"Embedder: local (default), api (requires --embedder-url + --embedder-model)",
		)
		.option("--embedder-url <url>", "Embedder API URL (or shortcut: lmstudio, ollama)")
		.option("--embedder-key <key>", "Embedder API key")
		.option("--embedder-model <model>", "Embedder model name") as T;
}

export function getStore(program: Command) {
	const globalOpts = program.opts();
	const storageType = (globalOpts.storage ?? "local") as "local" | "foc";
	return createStore({ storage: storageType });
}

export function getFormat(opts: { json?: boolean; quiet?: boolean }): OutputFormat {
	if (opts.json) return "json";
	if (opts.quiet) return "quiet";
	return "human";
}

export function getFirstMatchGroup(
	match: RegExpMatchArray | RegExpExecArray,
	index = 1,
): string | null {
	return typeof match[index] === "string" ? match[index] : null;
}

/**
 * Create an embedder based on CLI flags.
 *
 * --embedder-url determines the API endpoint. Well-known shortcuts:
 *   "lmstudio" → http://localhost:1234/v1
 *   "ollama"   → http://localhost:11434/v1
 *   Any URL    → used directly
 *
 * --embedder-model is REQUIRED for API embedders (no guessing what model is loaded).
 * --embedder local  → use transformers.js (default, no server needed)
 */
export function createEmbedder(opts: {
	embedder?: string;
	embedderUrl?: string;
	embedderKey?: string;
	embedderModel?: string;
}): { embedder: Embedder; modelName: string } {
	const type = opts.embedder ?? "local";

	// API-based embedder (any OpenAI-compatible endpoint)
	if (type === "api" || opts.embedderUrl || opts.embedderModel) {
		// Resolve URL shortcuts
		const urlShortcuts: Record<string, string> = {
			lmstudio: "http://localhost:1234/v1",
			ollama: "http://localhost:11434/v1",
		};
		const rawUrl = opts.embedderUrl ?? type;
		const baseUrl = urlShortcuts[rawUrl] ?? rawUrl;

		if (!baseUrl.startsWith("http")) {
			console.error(
				`Error: --embedder-url must be a URL or shortcut (lmstudio, ollama). Got: "${rawUrl}"`,
			);
			process.exit(2);
		}

		const model = opts.embedderModel;
		if (!model) {
			console.error("Error: --embedder-model is required for API embedders.");
			console.error("  The model name must match what the server has loaded.");
			console.error("  Example: --embedder-url lmstudio --embedder-model mxbai-embed-large-v1");
			process.exit(2);
		}

		const apiKey = opts.embedderKey ?? process.env.WTFOC_OPENAI_API_KEY ?? "no-key";
		const embedder = new OpenAIEmbedder({ apiKey, baseUrl, model });
		return { embedder, modelName: model };
	}

	// Default: local transformers.js (works everywhere, lower quality)
	if (type === "local" || type === "transformers") {
		try {
			console.error(
				"ℹ️  Using local MiniLM embedder (384d). For better results, use --embedder-url lmstudio --embedder-model <model>",
			);
			const embedder = new TransformersEmbedder();
			return { embedder, modelName: "Xenova/all-MiniLM-L6-v2" };
		} catch {
			console.error("⚠️  TransformersEmbedder unavailable, using zero-vector fallback");
			return {
				embedder: {
					dimensions: 384,
					async embed(): Promise<Float32Array> {
						return new Float32Array(384);
					},
					async embedBatch(texts: string[]): Promise<Float32Array[]> {
						return texts.map(() => new Float32Array(384));
					},
				},
				modelName: "zero-vector-fallback",
			};
		}
	}

	console.error(
		`Unknown embedder: "${type}". Use "local" or provide --embedder-url + --embedder-model.`,
	);
	process.exit(2);
}

export async function loadCollection(
	store: ReturnType<typeof createStore>,
	manifest: CollectionHead,
): Promise<LoadedCollection> {
	const vectorIndex = new InMemoryVectorIndex();
	const segments: Segment[] = [];

	for (const segSummary of manifest.segments) {
		const segBytes = await store.storage.download(segSummary.id);
		const segment = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
		segments.push(segment);

		// Add chunks to vector index
		const entries: VectorEntry[] = segment.chunks.map((c) => ({
			id: c.id,
			vector: new Float32Array(c.embedding),
			storageId: c.storageId || segSummary.id,
			metadata: {
				sourceType: c.sourceType,
				source: c.source,
				sourceUrl: c.sourceUrl ?? "",
				content: c.content,
				...c.metadata,
			},
		}));
		await vectorIndex.add(entries);
	}

	return { vectorIndex, segments };
}

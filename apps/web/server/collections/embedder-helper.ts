/**
 * Provides the default embedder for the ingest worker,
 * reusing the server's embedder configuration from .wtfoc.json / env vars.
 */
import type { Embedder } from "@wtfoc/common";

let cached: { embedder: Embedder; modelName: string } | null = null;

export async function getDefaultEmbedder(): Promise<{ embedder: Embedder; modelName: string }> {
	if (cached) return cached;

	const { loadProjectConfig, resolveConfig } = await import("@wtfoc/config");

	let url: string | undefined;
	let apiKey: string | undefined;
	let model: string | undefined;
	let dimensions: number | undefined;

	try {
		const fileConfig = loadProjectConfig();
		const resolved = resolveConfig({ file: fileConfig });
		url = resolved.embedder?.url;
		apiKey = resolved.embedder?.key;
		model = resolved.embedder?.model;
		dimensions = resolved.embedder?.dimensions;
	} catch {
		// No config file — fall back to env vars
	}

	url = url ?? process.env["WTFOC_EMBEDDER_URL"];
	apiKey = apiKey ?? process.env["WTFOC_EMBEDDER_KEY"] ?? process.env["WTFOC_OPENAI_API_KEY"] ?? "no-key";
	model = model ?? process.env["WTFOC_EMBEDDER_MODEL"];

	if (url && model) {
		const { OpenAIEmbedder } = await import("@wtfoc/search");
		const embedder = new OpenAIEmbedder({ apiKey, baseUrl: url, model, dimensions });
		cached = { embedder, modelName: model };
	} else {
		const { TransformersEmbedder } = await import("@wtfoc/search");
		const modelName = model ?? "Xenova/all-MiniLM-L6-v2";
		const embedder = new TransformersEmbedder(modelName);
		cached = { embedder, modelName };
	}

	return cached;
}

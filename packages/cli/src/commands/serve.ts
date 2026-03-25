import type { Command } from "commander";
import { getProjectConfig } from "../cli.js";
import { createEmbedder, type EmbedderOpts, getStore, withEmbedderOptions } from "../helpers.js";

export function registerServeCommand(program: Command): void {
	withEmbedderOptions(
		program
			.command("serve")
			.description("Start HTTP server with web UI for exploring a collection")
			.requiredOption("-c, --collection <name>", "Collection name")
			.option("-p, --port <number>", "Port to listen on", "3577"),
	).action(async (opts: { collection: string; port: string } & EmbedderOpts) => {
		const store = getStore(program);
		const { embedder } = createEmbedder(opts, getProjectConfig()?.embedder);

		// Load UI HTML at startup (bundled alongside the CLI)
		const { readFile } = await import("node:fs/promises");
		const { fileURLToPath } = await import("node:url");
		const { join, dirname } = await import("node:path");
		const __dirname = dirname(fileURLToPath(import.meta.url));
		const uiHtml = await readFile(join(__dirname, "..", "ui.html"), "utf-8");

		const { startServer } = await import("../serve.js");
		await startServer({
			store,
			collection: opts.collection,
			embedder,
			port: Number.parseInt(opts.port, 10),
			html: uiHtml,
		});
	});
}

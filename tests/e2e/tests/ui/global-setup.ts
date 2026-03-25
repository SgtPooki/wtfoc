/**
 * Playwright global setup: seed fixture data and start the web server.
 *
 * We handle the server lifecycle here (rather than in playwright.config.ts
 * webServer) because the seed step must complete before the server starts,
 * and the server needs env vars pointing at the seeded temp dirs.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FullConfig } from "@playwright/test";
import { TransformersEmbedder } from "@wtfoc/search";
import { LocalManifestStore, LocalStorageBackend } from "@wtfoc/store";
import { FIXTURE_FOC_CLI, FIXTURE_KNOWLEDGE_BASE, FIXTURE_SYNAPSE_SDK } from "../../helpers/fixtures.js";
import { seedCollection } from "../../helpers/seed.js";

const MONO_ROOT = resolve(import.meta.dirname ?? ".", "../../../..");
const SERVER_ENTRY = resolve(MONO_ROOT, "apps/web/server/dist/index.js");
const PORT = 3599;

let serverProcess: ChildProcess | null = null;
let dataDir: string;
let manifestDir: string;

export default async function globalSetup(_config: FullConfig) {
	dataDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-ui-data-"));
	manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-ui-manifest-"));

	// Seed test data
	const embedder = new TransformersEmbedder();
	const storage = new LocalStorageBackend(dataDir);
	const manifests = new LocalManifestStore(manifestDir);

	await seedCollection("ui-test", [
		{ source: "synapse-sdk/README.md", content: FIXTURE_SYNAPSE_SDK },
		{ source: "foc-cli/README.md", content: FIXTURE_FOC_CLI },
		{ source: "kb/architecture.md", content: FIXTURE_KNOWLEDGE_BASE },
	], { storage, manifests, embedder });

	// Start the web server
	serverProcess = spawn("node", [SERVER_ENTRY], {
		env: {
			...process.env,
			WTFOC_PORT: String(PORT),
			WTFOC_DATA_DIR: dataDir,
			WTFOC_MANIFEST_DIR: manifestDir,
			WTFOC_VECTOR_BACKEND: "inmemory",
			WTFOC_WEB_DIR: resolve(MONO_ROOT, "apps/web/dist"),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	// Wait for server ready
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("Server start timeout (30s)")), 30_000);
		let stderr = "";

		serverProcess!.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
			if (stderr.includes("wtfoc web running at")) {
				clearTimeout(timeout);
				resolve();
			}
		});

		serverProcess!.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});

		serverProcess!.on("exit", (code) => {
			clearTimeout(timeout);
			reject(new Error(`Server exited early (code ${code}):\n${stderr}`));
		});
	});

	// Return teardown
	return async () => {
		if (serverProcess && serverProcess.exitCode === null) {
			serverProcess.kill("SIGTERM");
			await new Promise<void>((resolve) => {
				const t = setTimeout(() => {
					serverProcess?.kill("SIGKILL");
					resolve();
				}, 5_000);
				serverProcess!.on("exit", () => {
					clearTimeout(t);
					resolve();
				});
			});
		}
		await rm(dataDir, { recursive: true, force: true });
		await rm(manifestDir, { recursive: true, force: true });
	};
}

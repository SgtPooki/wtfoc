/**
 * Playwright global setup: seed fixture data and start the web server.
 *
 * We handle the server lifecycle here (rather than in playwright.config.ts
 * webServer) because the seed step must complete before the server starts,
 * and the server needs env vars pointing at the seeded temp dirs.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FullConfig } from "@playwright/test";
import { LocalManifestStore, LocalStorageBackend } from "@wtfoc/store";
import { createTestEmbedder } from "../../helpers/embedder.js";
import { FIXTURE_FOC_CLI, FIXTURE_KNOWLEDGE_BASE, FIXTURE_SYNAPSE_SDK } from "../../helpers/fixtures.js";
import { seedCollection } from "../../helpers/seed.js";

const MONO_ROOT = resolve(import.meta.dirname ?? ".", "../../../..");
const SERVER_ENTRY = resolve(MONO_ROOT, "apps/web/server/dist/index.js");
const PORT = (() => {
	const value = process.env["WTFOC_TEST_PORT"];
	if (value === undefined) return 3599;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? 3599 : parsed;
})();

let serverProcess: ChildProcess | null = null;
let dataDir: string;
let manifestDir: string;

export default async function globalSetup(_config: FullConfig) {
	if (!existsSync(SERVER_ENTRY)) {
		throw new Error(
			`Server entry not found: ${SERVER_ENTRY}\n` +
			"Run 'pnpm build && pnpm --filter @wtfoc/web build:server' first.",
		);
	}

	dataDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-ui-data-"));
	manifestDir = await mkdtemp(join(tmpdir(), "wtfoc-e2e-ui-manifest-"));

	// Seed test data
	const embedder = createTestEmbedder();
	const storage = new LocalStorageBackend(dataDir);
	const manifests = new LocalManifestStore(manifestDir);

	await seedCollection("ui-test", [
		{ source: "synapse-sdk/README.md", content: FIXTURE_SYNAPSE_SDK },
		{ source: "foc-cli/README.md", content: FIXTURE_FOC_CLI },
		{ source: "kb/architecture.md", content: FIXTURE_KNOWLEDGE_BASE },
	], { storage, manifests, embedder });

	// Start the web server
	const child = spawn("node", [SERVER_ENTRY], {
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
	serverProcess = child;

	// Wait for server ready
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("Server start timeout (30s)")), 30_000);
		let stderr = "";

		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
			if (stderr.includes("wtfoc web running at")) {
				clearTimeout(timeout);
				resolve();
			}
		});

		child.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});

		child.on("exit", (code) => {
			clearTimeout(timeout);
			reject(new Error(`Server exited early (code ${code}):\n${stderr}`));
		});
	});

	// Return teardown
	return async () => {
		if (serverProcess && serverProcess.exitCode === null) {
			serverProcess.kill("SIGTERM");
			const proc = serverProcess;
			await new Promise<void>((resolve) => {
				const t = setTimeout(() => {
					proc.kill("SIGKILL");
					resolve();
				}, 5_000);
				proc.on("exit", () => {
					clearTimeout(t);
					resolve();
				});
			});
		}
		await rm(dataDir, { recursive: true, force: true });
		await rm(manifestDir, { recursive: true, force: true });
	};
}

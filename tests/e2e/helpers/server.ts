/**
 * Spawn and manage the wtfoc web server as a child process for e2e tests.
 */
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const MONO_ROOT = resolve(import.meta.dirname ?? ".", "../../..");
const SERVER_ENTRY = resolve(MONO_ROOT, "apps/web/server/dist/index.js");

export interface ServerOptions {
	port: number;
	dataDir: string;
	manifestDir: string;
	/** If set, use this as WTFOC_EMBEDDER_URL; otherwise fall back to local TransformersEmbedder */
	embedderUrl?: string;
	embedderModel?: string;
}

export interface RunningServer {
	port: number;
	baseUrl: string;
	process: ChildProcess;
	kill(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
	if (!existsSync(SERVER_ENTRY)) {
		throw new Error(
			`Server entry not found: ${SERVER_ENTRY}\n` +
			"Run 'pnpm build && pnpm --filter @wtfoc/web build:server' first.",
		);
	}

	const env: Record<string, string> = {
		WTFOC_PORT: String(opts.port),
		WTFOC_DATA_DIR: opts.dataDir,
		WTFOC_MANIFEST_DIR: opts.manifestDir,
		WTFOC_WEB_DIR: resolve(MONO_ROOT, "apps/web/dist"),
		WTFOC_VECTOR_BACKEND: "inmemory",
		// Prevent .wtfoc.json from overriding the embedder to a remote service
		// (e.g., ollama) that isn't available in CI. E2E tests use the local
		// TransformersEmbedder which matches what seedCollection uses.
		WTFOC_CONFIG_DIR: opts.manifestDir,
	};

	// Inherit safe env vars from parent process
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !(key in env)) {
			env[key] = value;
		}
	}

	// Force local TransformersEmbedder — clear any env vars that would
	// point the server at a remote embedder (ollama, OpenAI, etc.)
	delete env["WTFOC_EMBEDDER_URL"];
	delete env["WTFOC_EMBEDDER_KEY"];
	delete env["WTFOC_OPENAI_API_KEY"];

	if (opts.embedderUrl) {
		env["WTFOC_EMBEDDER_URL"] = opts.embedderUrl;
		env["WTFOC_EMBEDDER_MODEL"] = opts.embedderModel ?? "mock";
	}

	const child = spawn("node", [SERVER_ENTRY], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
		// Run from the temp manifest dir so the server doesn't pick up
		// .wtfoc.json from the repo root (which may point at an unavailable
		// remote embedder like ollama).
		cwd: opts.manifestDir,
	});

	const baseUrl = `http://localhost:${opts.port}`;

	// Capture stderr for debugging
	let allStderr = "";

	// Wait for the server ready line
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			console.error(`[e2e-server] Timeout waiting for server. stderr so far:\n${allStderr}`);
			reject(new Error("Server start timeout (15s)"));
		}, 15_000);

		child.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			allStderr += text;
			// Log server stderr in real-time for CI debugging
			process.stderr.write(`[e2e-server] ${text}`);
			if (allStderr.includes("wtfoc web running at")) {
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
			reject(new Error(`Server exited early with code ${code}.\nstderr: ${allStderr}`));
		});
	});

	// Continue logging server stderr after startup (catches runtime errors)
	child.stderr?.on("data", (chunk: Buffer) => {
		process.stderr.write(`[e2e-server] ${chunk.toString()}`);
	});

	return {
		port: opts.port,
		baseUrl,
		process: child,
		async kill() {
			if (child.exitCode !== null) return;
			child.kill("SIGTERM");
			await new Promise<void>((resolve) => {
				const t = setTimeout(() => {
					child.kill("SIGKILL");
					resolve();
				}, 5_000);
				child.on("exit", () => {
					clearTimeout(t);
					resolve();
				});
			});
		},
	};
}

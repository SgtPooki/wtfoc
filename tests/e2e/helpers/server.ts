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
	};

	// Inherit safe env vars from parent process
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !(key in env)) {
			env[key] = value;
		}
	}

	if (opts.embedderUrl) {
		env["WTFOC_EMBEDDER_URL"] = opts.embedderUrl;
		env["WTFOC_EMBEDDER_MODEL"] = opts.embedderModel ?? "mock";
	}

	const child = spawn("node", [SERVER_ENTRY], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});

	const baseUrl = `http://localhost:${opts.port}`;

	// Wait for the server ready line
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("Server start timeout (15s)")), 15_000);
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
			reject(new Error(`Server exited early with code ${code}.\nstderr: ${stderr}`));
		});
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

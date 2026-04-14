#!/usr/bin/env node
/**
 * Minimal OpenAI-compatible proxy that reads Claude Code's OAuth token
 * from ~/.claude/.credentials.json (or the macOS keychain as a fallback)
 * and forwards requests directly to the Anthropic API. No subprocess
 * spawning for requests — just HTTP proxying.
 *
 * Usage: node scripts/claude-direct-proxy.mjs [--port 4523]
 */

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PORT = (() => {
	const idx = process.argv.indexOf("--port");
	if (idx === -1) return 4523;
	const val = parseInt(process.argv[idx + 1], 10);
	if (Number.isNaN(val) || val < 1 || val > 65535) {
		console.error(`Invalid --port value. Usage: node claude-direct-proxy.mjs --port <1-65535>`);
		process.exit(2);
	}
	return val;
})();
const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const API_URL = "https://api.anthropic.com/v1/messages";
const REQUIRED_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

let cachedToken = null;
let tokenExpiresAt = 0;
/** Remembers which credential source worked so we write refreshed tokens back to the same place. */
let credentialSource = null; // "file" | "keychain"

/**
 * Read raw credentials JSON, preferring the on-disk file, falling back to
 * the macOS keychain ("Claude Code-credentials" generic password). Sets
 * `credentialSource` so `refreshToken()` can persist back to the same store.
 */
async function readCredentials() {
	try {
		const text = await readFile(CREDENTIALS_PATH, "utf-8");
		credentialSource = "file";
		return JSON.parse(text);
	} catch (err) {
		if (err?.code !== "ENOENT") throw err;
	}

	if (platform() === "darwin") {
		try {
			const { stdout } = await execFileAsync("security", [
				"find-generic-password",
				"-s",
				"Claude Code-credentials",
				"-w",
			]);
			credentialSource = "keychain";
			return JSON.parse(stdout.trim());
		} catch (err) {
			throw new Error(
				`No credentials in ${CREDENTIALS_PATH} and macOS keychain lookup failed: ${err.message}`,
			);
		}
	}

	throw new Error(`No credentials file at ${CREDENTIALS_PATH} (and no keychain on this platform)`);
}

/**
 * Persist refreshed credentials back to whichever source we loaded from.
 * Keeps keychain-backed installations keychain-only (no tokens on disk).
 */
async function writeCredentials(creds) {
	if (credentialSource === "keychain" && platform() === "darwin") {
		await execFileAsync("security", [
			"add-generic-password",
			"-U", // update if exists
			"-s",
			"Claude Code-credentials",
			"-a",
			process.env.USER ?? "",
			"-w",
			JSON.stringify(creds),
		]);
		return;
	}
	const { writeFile } = await import("node:fs/promises");
	await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
}

async function getToken() {
	// Return cached if still valid (with 5 min buffer)
	if (cachedToken && Date.now() < tokenExpiresAt - 300_000) {
		return cachedToken;
	}

	const creds = await readCredentials();
	const oauth = creds.claudeAiOauth;
	if (!oauth?.accessToken)
		throw new Error(
			`No OAuth token found (source=${credentialSource ?? "unknown"}). Run any 'claude' command to refresh.`,
		);

	// If token is expired, try to refresh
	if (Date.now() >= oauth.expiresAt) {
		console.error("[proxy] Token expired, refreshing...");
		const refreshed = await refreshToken(oauth.refreshToken);
		if (refreshed) {
			cachedToken = refreshed.accessToken;
			tokenExpiresAt = refreshed.expiresAt;
			return cachedToken;
		}
		throw new Error("Token expired and refresh failed. Run any claude command to refresh.");
	}

	cachedToken = oauth.accessToken;
	tokenExpiresAt = oauth.expiresAt;
	return cachedToken;
}

async function refreshToken(refreshToken) {
	try {
		const res = await fetch("https://console.anthropic.com/v1/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: CLIENT_ID,
			}),
		});
		if (!res.ok) {
			console.error(`[proxy] Refresh failed: ${res.status} ${await res.text()}`);
			return null;
		}
		const data = await res.json();
		// Write refreshed tokens back to the same source we loaded from (file or keychain).
		const creds = await readCredentials();
		creds.claudeAiOauth.accessToken = data.access_token;
		creds.claudeAiOauth.refreshToken = data.refresh_token ?? creds.claudeAiOauth.refreshToken;
		creds.claudeAiOauth.expiresAt = Date.now() + (data.expires_in ?? 28800) * 1000;
		await writeCredentials(creds);
		console.error(`[proxy] Token refreshed successfully (source=${credentialSource})`);
		return {
			accessToken: data.access_token,
			expiresAt: creds.claudeAiOauth.expiresAt,
		};
	} catch (err) {
		console.error("[proxy] Refresh error:", err.message);
		return null;
	}
}

// Model name mapping (OpenAI-style -> Anthropic model IDs)
const MODEL_MAP = {
	"haiku": "claude-haiku-4-5-20251001",
	"claude-haiku-4-5": "claude-haiku-4-5-20251001",
	"sonnet": "claude-sonnet-4-6-20250514",
	"claude-sonnet-4-6": "claude-sonnet-4-6-20250514",
	"opus": "claude-opus-4-6-20250610",
	"claude-opus-4-6": "claude-opus-4-6-20250610",
};

function mapModel(model) {
	return MODEL_MAP[model] ?? model;
}

// Convert OpenAI chat completion request -> Anthropic messages request
function convertRequest(openaiBody) {
	const messages = [];
	let systemText = REQUIRED_SYSTEM;

	for (const msg of openaiBody.messages ?? []) {
		if (msg.role === "system") {
			systemText = REQUIRED_SYSTEM + "\n\n" + msg.content;
		} else {
			messages.push({ role: msg.role, content: msg.content });
		}
	}

	return {
		model: mapModel(openaiBody.model ?? "haiku"),
		max_tokens: openaiBody.max_tokens ?? 4096,
		system: systemText,
		messages,
	};
}

// Convert Anthropic response -> OpenAI chat completion response
function convertResponse(anthropicRes) {
	const content = anthropicRes.content?.map(b => b.text).join("") ?? "";
	return {
		id: anthropicRes.id ?? "msg_proxy",
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: anthropicRes.model ?? "unknown",
		choices: [{
			index: 0,
			message: { role: "assistant", content },
			finish_reason: anthropicRes.stop_reason === "end_turn" ? "stop" : (anthropicRes.stop_reason ?? "stop"),
		}],
		usage: {
			prompt_tokens: anthropicRes.usage?.input_tokens ?? 0,
			completion_tokens: anthropicRes.usage?.output_tokens ?? 0,
			total_tokens: (anthropicRes.usage?.input_tokens ?? 0) + (anthropicRes.usage?.output_tokens ?? 0),
		},
	};
}

const server = createServer(async (req, res) => {
	// CORS
	if (req.method === "OPTIONS") {
		res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" });
		res.end();
		return;
	}

	const url = req.url ?? "/";

	if (url === "/health") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok" }));
		return;
	}

	if (url === "/v1/models") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ object: "list", data: [
			{ id: "haiku", object: "model" },
			{ id: "sonnet", object: "model" },
			{ id: "opus", object: "model" },
		]}));
		return;
	}

	if (url === "/v1/chat/completions" && req.method === "POST") {
		const start = Date.now();
		let body = "";
		for await (const chunk of req) body += chunk;

		try {
			const token = await getToken();
			const openaiReq = JSON.parse(body);
			const anthropicReq = convertRequest(openaiReq);

			const apiRes = await fetch(API_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${token}`,
					"anthropic-version": "2023-06-01",
					"anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
					"User-Agent": "claude-cli/2.1.84 (external, cli)",
				},
				body: JSON.stringify(anthropicReq),
			});

			if (!apiRes.ok) {
				const errText = await apiRes.text();
				// If auth error, invalidate cache and retry once
				if (apiRes.status === 401) {
					cachedToken = null;
					tokenExpiresAt = 0;
				}
				console.error(`[proxy] API error ${apiRes.status}: ${errText}`);
				res.writeHead(apiRes.status, { "Content-Type": "application/json" });
				res.end(errText);
				return;
			}

			const anthropicRes = await apiRes.json();
			const openaiRes = convertResponse(anthropicRes);

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(openaiRes));
			console.error(`[proxy] ${anthropicReq.model} ${Date.now() - start}ms`);
		} catch (err) {
			console.error(`[proxy] Error: ${err.message}`);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: { message: err.message } }));
		}
		return;
	}

	res.writeHead(404, { "Content-Type": "text/plain" });
	res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
	console.error(`[proxy] Claude direct proxy listening on http://127.0.0.1:${PORT}`);
	console.error(`[proxy] POST /v1/chat/completions (OpenAI-compatible)`);
	console.error(`[proxy] Models: haiku, sonnet, opus`);
});

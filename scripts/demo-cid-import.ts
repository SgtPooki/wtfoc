#!/usr/bin/env -S pnpm tsx --tsconfig scripts/tsconfig.json
/**
 * Phase 2 demo rehearsal (#288). Exercises POST /api/wallet-collections/cid
 * → SSE progress stream → terminal state → query result, against a live
 * wtfoc web server. Run this before the June 7 demo to confirm the stack
 * is healthy end-to-end — it does NOT run in CI because it requires a
 * running server + wallet session.
 *
 * Usage:
 *   export WTFOC_DEMO_BASE=http://localhost:3577
 *   export WTFOC_DEMO_SESSION=<cookie token>  # set by the auth flow
 *   pnpm tsx scripts/demo-cid-import.ts --cid=bafy... --name=demo --query="what is x"
 */

interface Args {
	cid: string;
	name: string;
	query?: string;
}

function parseArgs(argv: string[]): Args {
	const out: Partial<Args> = {};
	for (const arg of argv.slice(2)) {
		const match = arg.match(/^--([^=]+)=(.+)$/);
		if (!match) continue;
		const [, key, value] = match;
		if (key === "cid") out.cid = value;
		else if (key === "name") out.name = value;
		else if (key === "query") out.query = value;
	}
	if (!out.cid) throw new Error("missing --cid=<manifestCid>");
	if (!out.name) throw new Error("missing --name=<collectionName>");
	return out as Args;
}

interface JobView {
	id: string;
	status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
	phase: string | null;
	current: number;
	total: number;
	message?: string | null;
	errorMessage?: string | null;
}

const BASE = process.env.WTFOC_DEMO_BASE ?? "http://localhost:3577";
const SESSION = process.env.WTFOC_DEMO_SESSION;

function authHeaders(): Record<string, string> {
	if (!SESSION) {
		throw new Error("WTFOC_DEMO_SESSION not set — authenticate via the UI and copy the cookie value");
	}
	return {
		Cookie: `wtfoc_session=${SESSION}`,
		"Content-Type": "application/json",
	};
}

async function postImport(cid: string, name: string): Promise<{ jobId: string; collectionId: string }> {
	const res = await fetch(`${BASE}/api/wallet-collections/cid`, {
		method: "POST",
		headers: authHeaders(),
		body: JSON.stringify({ manifestCid: cid, name }),
	});
	if (!res.ok) {
		throw new Error(`POST /cid failed: ${res.status} ${await res.text()}`);
	}
	const body = (await res.json()) as { jobId: string; collectionId: string };
	return body;
}

async function streamProgress(jobId: string): Promise<JobView> {
	return new Promise((resolve, reject) => {
		const url = `${BASE}/api/jobs/${encodeURIComponent(jobId)}/events`;
		let controller: AbortController | undefined;
		const tail = async () => {
			controller = new AbortController();
			try {
				const res = await fetch(url, {
					headers: authHeaders(),
					signal: controller.signal,
				});
				if (!res.ok || !res.body) throw new Error(`SSE open failed: ${res.status}`);
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				let lastEvent = "";
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const parts = buffer.split("\n\n");
					buffer = parts.pop() ?? "";
					for (const part of parts) {
						let event = "snapshot";
						let data = "";
						for (const line of part.split("\n")) {
							if (line.startsWith("event:")) event = line.slice(6).trim();
							else if (line.startsWith("data:")) data += line.slice(5).trim();
						}
						if (event === "ping") continue;
						if (event !== "snapshot") continue;
						if (event === lastEvent && !data) continue;
						lastEvent = event;
						try {
							const job = JSON.parse(data) as JobView;
							const pct = job.total > 0 ? Math.round((job.current / job.total) * 100) : 0;
							process.stderr.write(
								`[sse] ${job.status.padEnd(9)} ${(job.phase ?? "").padEnd(24)} ${job.current}/${job.total} (${pct}%) ${job.message ?? ""}\n`,
							);
							if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
								controller?.abort();
								resolve(job);
								return;
							}
						} catch (err) {
							process.stderr.write(`[sse] parse error: ${err instanceof Error ? err.message : err}\n`);
						}
					}
				}
			} catch (err) {
				if (controller?.signal.aborted) return;
				reject(err);
			}
		};
		tail();
	});
}

async function runQuery(collectionName: string, q: string): Promise<unknown> {
	const res = await fetch(
		`${BASE}/api/collections/${encodeURIComponent(collectionName)}/query?q=${encodeURIComponent(q)}&k=5`,
	);
	if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
	return res.json();
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);
	process.stderr.write(`[demo] BASE=${BASE} cid=${args.cid} name=${args.name}\n`);

	const started = Date.now();
	const { jobId, collectionId } = await postImport(args.cid, args.name);
	process.stderr.write(`[demo] enqueued jobId=${jobId} collectionId=${collectionId}\n`);

	const terminal = await streamProgress(jobId);
	const elapsed = Date.now() - started;
	process.stderr.write(`[demo] terminal=${terminal.status} after ${elapsed}ms\n`);
	if (terminal.status !== "succeeded") {
		throw new Error(`import ${terminal.status}: ${terminal.errorMessage ?? "(no message)"}`);
	}

	if (args.query) {
		const result = await runQuery(args.name, args.query);
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} else {
		process.stderr.write(`[demo] collection "${args.name}" ready; pass --query=... to run a query\n`);
	}
}

main().catch((err) => {
	process.stderr.write(`[demo] FAIL: ${err instanceof Error ? err.message : err}\n`);
	process.exit(1);
});

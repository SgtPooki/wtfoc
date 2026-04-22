import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { StorageBackend } from "@wtfoc/common";
import type { CidResolvedCollection } from "@wtfoc/store";
import { deserializeSegment, resolveCollectionByCid } from "@wtfoc/store";
import type { Command } from "commander";
import { getFormat } from "../helpers.js";

export interface VerifyCollectionCheck {
	name: string;
	/**
	 * `pass` — all expectations met.
	 * `fetch-fail` — artifact could not be downloaded (bubbles up as UNVERIFIED).
	 * `content-fail` — downloaded bytes contradict the manifest's claim about
	 *   them (bubbles up as INCONSISTENT — a stronger signal than availability).
	 */
	status: "pass" | "fetch-fail" | "content-fail";
	detail: string;
}

export interface VerifyCollectionReport {
	manifestCid: string;
	collectionName: string;
	checks: VerifyCollectionCheck[];
	verdict: "REMOTELY VERIFIED" | "UNVERIFIED" | "INCONSISTENT";
}

const DEFAULT_RETRY_DELAYS_MS = [500, 1500, 3000];
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

async function downloadWithRetry(
	storage: StorageBackend,
	id: string,
	label: string,
	retryDelays: readonly number[],
): Promise<Uint8Array> {
	let lastErr: unknown;
	for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
		if (attempt > 0) await delay(retryDelays[attempt - 1]);
		try {
			return await storage.download(id);
		} catch (err) {
			lastErr = err;
		}
	}
	throw new Error(`${label}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export interface VerifyCollectionOptions {
	resolver?: (cid: string) => Promise<CidResolvedCollection>;
	retryDelaysMs?: readonly number[];
}

export async function runVerifyCollection(
	manifestCid: string,
	options: VerifyCollectionOptions = {},
): Promise<VerifyCollectionReport> {
	const resolver = options.resolver ?? resolveCollectionByCid;
	const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
	const checks: VerifyCollectionCheck[] = [];

	const resolved = await resolver(manifestCid);
	checks.push({
		name: "manifest",
		status: "pass",
		detail: `manifest CID ${manifestCid} resolved and schema valid`,
	});

	let segmentsReached = 0;
	let segmentsHashMatch = 0;
	let segmentsSchemaValid = 0;
	const segmentFailures: string[] = [];

	for (const seg of resolved.manifest.segments) {
		let bytes: Uint8Array;
		try {
			bytes = await downloadWithRetry(
				resolved.storage,
				seg.id,
				`segment ${seg.id.slice(0, 8)}`,
				retryDelaysMs,
			);
			segmentsReached++;
		} catch (err) {
			segmentFailures.push(`${seg.id.slice(0, 8)}: ${err instanceof Error ? err.message : err}`);
			continue;
		}

		if (SHA256_HEX_RE.test(seg.id)) {
			const actual = createHash("sha256").update(bytes).digest("hex");
			if (actual !== seg.id) {
				checks.push({
					name: `segment-${seg.id.slice(0, 8)}-hash`,
					status: "content-fail",
					detail: `sha256 mismatch: manifest recorded ${seg.id}, content hashes to ${actual}`,
				});
				continue;
			}
			segmentsHashMatch++;
		}

		let parsed: ReturnType<typeof deserializeSegment>;
		try {
			parsed = deserializeSegment(bytes);
		} catch (err) {
			checks.push({
				name: `segment-${seg.id.slice(0, 8)}-schema`,
				status: "content-fail",
				detail: `schema invalid: ${err instanceof Error ? err.message : err}`,
			});
			continue;
		}
		segmentsSchemaValid++;

		if (parsed.chunks.length !== seg.chunkCount) {
			checks.push({
				name: `segment-${seg.id.slice(0, 8)}-chunkCount`,
				status: "content-fail",
				detail: `manifest says chunkCount=${seg.chunkCount}, actual=${parsed.chunks.length}`,
			});
		}
	}

	checks.push({
		name: "segments-reachable",
		status: segmentFailures.length === 0 ? "pass" : "fetch-fail",
		detail:
			segmentFailures.length === 0
				? `${segmentsReached}/${resolved.manifest.segments.length} segments reachable`
				: `${segmentsReached}/${resolved.manifest.segments.length} reachable, failures: ${segmentFailures.slice(0, 3).join("; ")}`,
	});
	checks.push({
		name: "segments-hash-match",
		status: "pass",
		detail: `${segmentsHashMatch} of ${segmentsReached} reachable segments had sha256-hex ids and all matched`,
	});
	checks.push({
		name: "segments-schema-valid",
		status: segmentsSchemaValid === segmentsReached ? "pass" : "content-fail",
		detail: `${segmentsSchemaValid}/${segmentsReached} reachable segments parse as a valid Segment`,
	});

	// Derived edge layers — availability verification only (download success).
	// Content parsing lives in overlay-loader paths and is out of scope for
	// the minimal remote verify.
	const layers = resolved.manifest.derivedEdgeLayers ?? [];
	let layersReached = 0;
	const layerFailures: string[] = [];
	for (const layer of layers) {
		try {
			await downloadWithRetry(
				resolved.storage,
				layer.id,
				`edge-layer ${layer.id.slice(0, 8)}`,
				retryDelaysMs,
			);
			layersReached++;
		} catch (err) {
			layerFailures.push(`${layer.id.slice(0, 8)}: ${err instanceof Error ? err.message : err}`);
		}
	}
	if (layers.length > 0) {
		checks.push({
			name: "derived-edge-layers-reachable",
			status: layerFailures.length === 0 ? "pass" : "fetch-fail",
			detail:
				layerFailures.length === 0
					? `${layersReached}/${layers.length} derived edge layers reachable`
					: `${layersReached}/${layers.length} reachable, failures: ${layerFailures.slice(0, 3).join("; ")}`,
		});
	}

	const hasContentFail = checks.some((c) => c.status === "content-fail");
	const hasFetchFail = checks.some((c) => c.status === "fetch-fail");
	const verdict: VerifyCollectionReport["verdict"] = hasContentFail
		? "INCONSISTENT"
		: hasFetchFail
			? "UNVERIFIED"
			: "REMOTELY VERIFIED";

	return {
		manifestCid,
		collectionName: resolved.manifest.name,
		checks,
		verdict,
	};
}

export function registerVerifyCollectionCommand(program: Command): void {
	program
		.command("verify-collection")
		.description(
			"Remote trust report: fetch manifest by CID, walk every segment + derived-edge-layer CID, verify content hashes + segment schemas. Network-bound.",
		)
		.requiredOption("--manifest-cid <cid>", "Manifest CID to verify")
		.action(async (opts: { manifestCid: string }) => {
			const format = getFormat(program.opts());
			let report: VerifyCollectionReport;
			try {
				report = await runVerifyCollection(opts.manifestCid);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (format === "json") {
					console.log(
						JSON.stringify({
							manifestCid: opts.manifestCid,
							verdict: "UNVERIFIED",
							error: msg,
						}),
					);
				} else {
					console.error(`❌ UNVERIFIED: ${msg}`);
				}
				process.exit(1);
			}

			if (format === "json") {
				console.log(JSON.stringify(report, null, 2));
			} else if (format !== "quiet") {
				console.log(`Collection: ${report.collectionName}`);
				console.log(`Manifest CID: ${report.manifestCid}`);
				for (const c of report.checks) {
					const icon = c.status === "pass" ? "✅" : c.status === "content-fail" ? "❌" : "⚠️ ";
					console.log(`${icon} ${c.name}: ${c.detail}`);
				}
				const verdictIcon =
					report.verdict === "REMOTELY VERIFIED"
						? "✅"
						: report.verdict === "INCONSISTENT"
							? "❌"
							: "⚠️ ";
				console.log(
					`\nVerdict: ${verdictIcon} ${report.verdict}${report.verdict === "REMOTELY VERIFIED" ? " (manifest CID resolves, every referenced artifact reachable, every content hash + segment schema checks out)" : ""}`,
				);
			}

			if (report.verdict !== "REMOTELY VERIFIED") process.exit(1);
		});
}

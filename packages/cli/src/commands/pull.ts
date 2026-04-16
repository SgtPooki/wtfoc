import { createHash } from "node:crypto";
import type {
	CollectionHead,
	DocumentCatalog,
	PublishedArtifactRef,
	PublishedSidecarRole,
	Segment,
} from "@wtfoc/common";
import {
	archiveIndexPath,
	catalogFilePath,
	type RawSourceIndex,
	writeArchiveIndex,
	writeCatalog,
} from "@wtfoc/ingest";
import { type CidResolvedCollection, resolveCollectionByCid } from "@wtfoc/store";
import type { Command } from "commander";
import { getFormat, getManifestDir, getStore } from "../helpers.js";

interface PullProgress {
	total: number;
	downloaded: number;
	byKind: Record<PublishedArtifactRef["kind"], number>;
}

interface PullOptions {
	name?: string;
	verifyOnly?: boolean;
}

export function registerPullCommand(program: Command): void {
	program
		.command("pull <cid>")
		.description("Pull a collection from FOC/IPFS by manifest CID into local storage")
		.option("-n, --name <name>", "Local collection name (default: derived from manifest)")
		.option(
			"--verify-only",
			"Download every artifact and validate integrity without writing locally. Useful for checking a published CID before importing.",
		)
		.action(async (cid: string, opts: PullOptions) => {
			const store = getStore(program);
			const format = getFormat(program.opts());
			const manifestDir = getManifestDir(store);
			const verifyOnly = Boolean(opts.verifyOnly);

			if (format === "human") {
				console.error(`⏳ ${verifyOnly ? "Verifying" : "Fetching"} manifest from CID ${cid}...`);
			}

			const resolved = await resolveCollectionByCid(cid);
			const { manifest } = resolved;
			const name = opts.name ?? manifest.name;

			if (format === "human") {
				console.error(`📦 Collection: "${manifest.name}"`);
				console.error(
					`   ${manifest.totalChunks} chunks, ${manifest.segments.length} segments, ${manifest.embeddingModel} (${manifest.embeddingDimensions}d)`,
				);
				if (manifest.artifactRefs) {
					console.error(
						`   ${manifest.artifactRefs.length} artifact refs (self-contained publication)`,
					);
				} else {
					console.error(
						`   ⚠️  No artifact refs on this manifest — older pre-self-containment publish. ${verifyOnly ? "Verifying segments only" : "Pulling segments only (raw sources + sidecars will not travel)"}.`,
					);
				}
			}

			// Existing-collection collision check only applies when we're actually
			// writing locally — verify-only has no local side effects.
			if (!verifyOnly) {
				const existing = await store.manifests.getHead(name);
				if (existing) {
					console.error(
						`⚠️  Collection "${name}" already exists locally (${existing.manifest.totalChunks} chunks).`,
					);
					console.error(
						`   Use --name <other-name> to pull under a different name, or delete the existing collection first.`,
					);
					process.exit(1);
				}
			}

			const progress: PullProgress = {
				total: 0,
				downloaded: 0,
				byKind: {
					segment: 0,
					"derived-edge-layer": 0,
					"raw-source-blob": 0,
					sidecar: 0,
				},
			};

			if (manifest.artifactRefs && manifest.artifactRefs.length > 0) {
				// Self-contained path: walk the publication index, download every
				// artifact, validate byteLength + sha256, cross-check raw-source
				// sidecar against raw-source-blob refs, optionally write locally.
				await pullArtifactRefs({
					refs: manifest.artifactRefs,
					resolved,
					store,
					manifestDir,
					collectionName: name,
					format,
					progress,
					verifyOnly,
				});
			} else {
				await pullLegacySegments({
					manifest,
					resolved,
					store,
					format,
					progress,
					verifyOnly,
				});
			}

			if (!verifyOnly) {
				await store.manifests.putHead(name, manifest, null);
			}

			emitResult({
				verifyOnly,
				cid,
				name,
				manifest,
				progress,
				format,
			});
		});
}

async function pullArtifactRefs(args: {
	refs: PublishedArtifactRef[];
	resolved: CidResolvedCollection;
	store: ReturnType<typeof getStore>;
	manifestDir: string;
	collectionName: string;
	format: string;
	progress: PullProgress;
	verifyOnly: boolean;
}): Promise<void> {
	const { refs, resolved, store, manifestDir, collectionName, format, progress, verifyOnly } = args;

	progress.total = refs.length;

	// Cross-reference scaffolding: every storageId referenced by the
	// raw-source-index sidecar must have a matching raw-source-blob entry in
	// artifactRefs[], AND the sidecar entry's `checksum`/`byteLength` must
	// agree with the raw-source-blob ref's `sha256`/`byteLength`. Without the
	// field-level check, a maliciously-crafted publication could point at a
	// real blob CID while advertising wrong provenance metadata.
	const rawSourceBlobIndex = new Map<
		string,
		Extract<PublishedArtifactRef, { kind: "raw-source-blob" }>
	>();
	for (const r of refs) {
		if (r.kind === "raw-source-blob") rawSourceBlobIndex.set(r.storageId, r);
	}

	// Deferred sidecar writes: collect bytes during the integrity pass, apply
	// to disk only after cross-reference validation passes.
	const pendingSidecars: Array<{ role: PublishedSidecarRole; bytes: Uint8Array }> = [];

	for (const ref of refs) {
		const bytes = await downloadByRef(ref, resolved);

		if (bytes.length !== ref.byteLength) {
			throw new Error(
				`Byte-length mismatch for ${describeRef(ref)}: manifest says ${ref.byteLength}, downloaded ${bytes.length}.`,
			);
		}

		switch (ref.kind) {
			case "segment":
			case "derived-edge-layer":
			case "raw-source-blob": {
				const actualSha = sha256Hex(bytes);
				// Local storage IDs are content-addressed sha256 hex — we can
				// verify the identity without writing to local storage.
				if (actualSha !== ref.storageId) {
					throw new Error(
						`Storage-id mismatch pulling ${describeRef(ref)}: manifest expects storageId=${ref.storageId}, actual bytes hash to ${actualSha}. Pulled bytes do not match the manifest's artifact identity — refusing to save corrupt collection.`,
					);
				}
				if (ref.kind === "raw-source-blob" && actualSha !== ref.sha256) {
					throw new Error(
						`SHA-256 mismatch pulling raw-source blob ${ref.storageId}: manifest says ${ref.sha256}, actual ${actualSha}.`,
					);
				}
				if (!verifyOnly) {
					const uploadResult = await store.storage.upload(bytes);
					if (uploadResult.id !== ref.storageId) {
						throw new Error(
							`Local storage produced id ${uploadResult.id} for ${describeRef(ref)}, expected ${ref.storageId}. Local storage backend does not content-address consistently.`,
						);
					}
				}
				progress.byKind[ref.kind] += 1;
				break;
			}
			case "sidecar": {
				const actualSha = sha256Hex(bytes);
				if (actualSha !== ref.sha256) {
					throw new Error(
						`SHA-256 mismatch pulling sidecar ${ref.role}: expected ${ref.sha256}, got ${actualSha}.`,
					);
				}
				validateSidecarJson(ref.role, bytes);
				if (ref.role === "raw-source-index") {
					crossCheckRawSourceIndex(bytes, rawSourceBlobIndex);
				}
				pendingSidecars.push({ role: ref.role, bytes });
				progress.byKind.sidecar += 1;
				break;
			}
			default: {
				const exhaustive: never = ref;
				throw new Error(`Unhandled PublishedArtifactRef kind: ${JSON.stringify(exhaustive)}`);
			}
		}

		progress.downloaded += 1;
		if (format === "human" && progress.downloaded % 50 === 0) {
			const verb = verifyOnly ? "verified" : "downloaded";
			console.error(`   ${progress.downloaded}/${progress.total} artifacts ${verb}...`);
		}
	}

	// All validation passed. Commit sidecars to disk (no-op in verify-only mode).
	if (!verifyOnly) {
		for (const { role, bytes } of pendingSidecars) {
			await writeSidecar({ role, bytes, manifestDir, collectionName });
		}
	}
}

async function pullLegacySegments(args: {
	manifest: CollectionHead;
	resolved: CidResolvedCollection;
	store: ReturnType<typeof getStore>;
	format: string;
	progress: PullProgress;
	verifyOnly: boolean;
}): Promise<void> {
	const { manifest, resolved, store, format, progress, verifyOnly } = args;

	progress.total = manifest.segments.length;

	for (const segRef of manifest.segments) {
		const segBytes = await resolved.storage.download(segRef.id);

		const seg = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
		if (!seg.chunks || !Array.isArray(seg.chunks)) {
			throw new Error(
				`Pulled segment ${segRef.id} is not a valid Segment (missing chunks[]). Refusing to save corrupt collection.`,
			);
		}

		// Content-addressed identity check — only meaningful when the segment id
		// is a local SHA-256 hex id (64 lowercase hex chars). Pre-artifactRefs
		// collections promoted from a FOC-backed store may have CID-shaped ids;
		// for those, CID retrieval via verified-fetch already validates the
		// content so a local sha check here would spuriously fail.
		if (isLocalSha256HexId(segRef.id)) {
			const actualSha = sha256Hex(segBytes);
			if (actualSha !== segRef.id) {
				throw new Error(
					`Storage-id mismatch pulling segment ${segRef.id}: actual bytes hash to ${actualSha}.`,
				);
			}
		}

		if (!verifyOnly) {
			const uploadResult = await store.storage.upload(segBytes);
			if (isLocalSha256HexId(segRef.id) && uploadResult.id !== segRef.id) {
				throw new Error(
					`Local storage produced id ${uploadResult.id} for segment ${segRef.id}, expected ${segRef.id}.`,
				);
			}
		}
		progress.downloaded += 1;
		progress.byKind.segment += 1;

		if (format === "human" && progress.downloaded % 50 === 0) {
			const verb = verifyOnly ? "verified" : "downloaded";
			console.error(`   ${progress.downloaded}/${progress.total} segments ${verb}...`);
		}
	}
}

async function downloadByRef(
	ref: PublishedArtifactRef,
	resolved: CidResolvedCollection,
): Promise<Uint8Array> {
	switch (ref.kind) {
		case "segment":
		case "derived-edge-layer":
		case "raw-source-blob":
			return resolved.storage.download(ref.storageId);
		case "sidecar":
			return resolved.storage.download(ref.ipfsCid);
		default: {
			const exhaustive: never = ref;
			throw new Error(`Unhandled PublishedArtifactRef kind: ${JSON.stringify(exhaustive)}`);
		}
	}
}

async function writeSidecar(args: {
	role: PublishedSidecarRole;
	bytes: Uint8Array;
	manifestDir: string;
	collectionName: string;
}): Promise<void> {
	const { role, bytes, manifestDir, collectionName } = args;
	const decoded = JSON.parse(new TextDecoder().decode(bytes));
	switch (role) {
		case "raw-source-index": {
			const index = decoded as RawSourceIndex;
			await writeArchiveIndex(archiveIndexPath(manifestDir, collectionName), index);
			break;
		}
		case "document-catalog": {
			const catalog = decoded as DocumentCatalog;
			await writeCatalog(catalogFilePath(manifestDir, collectionName), catalog);
			break;
		}
		default: {
			const exhaustive: never = role;
			throw new Error(`Unhandled sidecar role: ${JSON.stringify(exhaustive)}`);
		}
	}
}

function validateSidecarJson(role: PublishedSidecarRole, bytes: Uint8Array): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch (err) {
		throw new Error(
			`Sidecar ${role} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(`Sidecar ${role} is not a JSON object.`);
	}
	switch (role) {
		case "raw-source-index": {
			const idx = parsed as Partial<RawSourceIndex>;
			if (idx.schemaVersion !== 1) {
				throw new Error(
					`Sidecar raw-source-index has unexpected schemaVersion=${idx.schemaVersion} (expected 1).`,
				);
			}
			if (!idx.entries || typeof idx.entries !== "object") {
				throw new Error("Sidecar raw-source-index has no entries map.");
			}
			break;
		}
		case "document-catalog": {
			const cat = parsed as Partial<DocumentCatalog>;
			if (cat.schemaVersion !== 1) {
				throw new Error(
					`Sidecar document-catalog has unexpected schemaVersion=${cat.schemaVersion} (expected 1).`,
				);
			}
			if (!cat.documents || typeof cat.documents !== "object") {
				throw new Error("Sidecar document-catalog has no documents map.");
			}
			break;
		}
		default: {
			const exhaustive: never = role;
			throw new Error(`Unhandled sidecar role: ${JSON.stringify(exhaustive)}`);
		}
	}
}

/**
 * Cross-reference check for the raw-source-index sidecar. Verifies:
 *   1. Every `storageId` referenced by an index entry has a matching
 *      `raw-source-blob` ref in `artifactRefs[]`.
 *   2. The entry's `checksum` equals the blob ref's `sha256`.
 *   3. The entry's `byteLength` equals the blob ref's `byteLength`.
 *
 * Without (2) + (3), a manifest could advertise wrong provenance metadata
 * on the index side while pointing at a real blob CID — verify would pass
 * but the written sidecar would carry lies about the blob's content.
 */
function crossCheckRawSourceIndex(
	bytes: Uint8Array,
	blobIndex: Map<string, Extract<PublishedArtifactRef, { kind: "raw-source-blob" }>>,
): void {
	const index = JSON.parse(new TextDecoder().decode(bytes)) as RawSourceIndex;
	const problems: string[] = [];

	for (const entry of Object.values(index.entries)) {
		const blobRef = blobIndex.get(entry.storageId);
		const label = `${entry.documentId}@${entry.documentVersionId} (storageId=${entry.storageId})`;

		if (!blobRef) {
			problems.push(`${label}: no matching raw-source-blob ref`);
			continue;
		}

		if (entry.checksum !== blobRef.sha256) {
			problems.push(
				`${label}: entry.checksum=${entry.checksum} disagrees with ref.sha256=${blobRef.sha256}`,
			);
		}

		if (entry.byteLength !== blobRef.byteLength) {
			problems.push(
				`${label}: entry.byteLength=${entry.byteLength} disagrees with ref.byteLength=${blobRef.byteLength}`,
			);
		}
	}

	if (problems.length > 0) {
		const listed = problems.slice(0, 5).join("\n  ");
		const more = problems.length > 5 ? `\n  (+${problems.length - 5} more)` : "";
		throw new Error(
			`Raw-source-index cross-reference failed — ${problems.length} inconsistency(ies):\n  ${listed}${more}\nManifest is inconsistent — refusing to save.`,
		);
	}
}

function describeRef(ref: PublishedArtifactRef): string {
	switch (ref.kind) {
		case "segment":
			return `segment ${ref.storageId}`;
		case "derived-edge-layer":
			return `derived-edge-layer ${ref.storageId} (${ref.extractorId})`;
		case "raw-source-blob":
			return `raw-source-blob ${ref.storageId} (${ref.documentId})`;
		case "sidecar":
			return `sidecar ${ref.role}`;
		default: {
			const exhaustive: never = ref;
			throw new Error(`Unhandled PublishedArtifactRef kind: ${JSON.stringify(exhaustive)}`);
		}
	}
}

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A local storage id is sha256 encoded as 64 lowercase hex chars. IPFS CIDs
 * typically start with `b`/`Q`/`z` base32/base58 characters and are longer.
 * This heuristic lets us gate the identity check to IDs we can recompute.
 */
function isLocalSha256HexId(id: string): boolean {
	return /^[0-9a-f]{64}$/.test(id);
}

function emitResult(args: {
	verifyOnly: boolean;
	cid: string;
	name: string;
	manifest: CollectionHead;
	progress: PullProgress;
	format: string;
}): void {
	const { verifyOnly, cid, name, manifest, progress, format } = args;

	if (format === "human") {
		const verb = verifyOnly ? "Verified" : "Pulled";
		console.error(
			`\n✅ ${verb} "${name}" — ${manifest.totalChunks} chunks in ${progress.byKind.segment} segments` +
				describeNonSegmentKinds(progress.byKind),
		);
		console.error(
			`   Embedding model: ${manifest.embeddingModel} (${manifest.embeddingDimensions}d)`,
		);
		if (!verifyOnly) {
			console.error(`\n   Query with:`);
			console.error(
				`   wtfoc query "your question" -c ${name} --embedder api --embedder-url ollama --embedder-model ${manifest.embeddingModel}`,
			);
		} else {
			console.error(`\n   (verify-only: nothing written locally)`);
		}
	}

	if (format === "json") {
		console.log(
			JSON.stringify({
				mode: verifyOnly ? "verify" : "pull",
				name,
				cid,
				chunks: manifest.totalChunks,
				segments: progress.byKind.segment,
				derivedEdgeLayers: progress.byKind["derived-edge-layer"],
				rawSourceBlobs: progress.byKind["raw-source-blob"],
				sidecars: progress.byKind.sidecar,
				model: manifest.embeddingModel,
				dimensions: manifest.embeddingDimensions,
			}),
		);
	}
}

function describeNonSegmentKinds(byKind: PullProgress["byKind"]): string {
	const parts: string[] = [];
	if (byKind["derived-edge-layer"] > 0) {
		parts.push(`${byKind["derived-edge-layer"]} derived-edge-layer(s)`);
	}
	if (byKind["raw-source-blob"] > 0) {
		parts.push(`${byKind["raw-source-blob"]} raw-source blob(s)`);
	}
	if (byKind.sidecar > 0) {
		parts.push(`${byKind.sidecar} sidecar(s)`);
	}
	return parts.length > 0 ? ` + ${parts.join(", ")}` : "";
}

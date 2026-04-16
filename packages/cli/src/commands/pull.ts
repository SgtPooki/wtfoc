import { createHash } from "node:crypto";
import type {
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

export function registerPullCommand(program: Command): void {
	program
		.command("pull <cid>")
		.description("Pull a collection from FOC/IPFS by manifest CID into local storage")
		.option("-n, --name <name>", "Local collection name (default: derived from manifest)")
		.action(async (cid: string, opts: { name?: string }) => {
			const store = getStore(program);
			const format = getFormat(program.opts());
			const manifestDir = getManifestDir(store);

			if (format === "human") console.error(`⏳ Fetching manifest from CID ${cid}...`);

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
						`   ⚠️  No artifact refs on this manifest — older pre-self-containment publish. Pulling segments only (raw sources + sidecars will not travel).`,
					);
				}
			}

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
				// artifact, validate byteLength + sha256, write to the right place.
				await pullArtifactRefs({
					refs: manifest.artifactRefs,
					resolved,
					store,
					manifestDir,
					collectionName: name,
					format,
					progress,
				});
			} else {
				// Back-compat path: pre-self-containment manifests only have
				// segment.ipfsCid (or no CID at all). Pull those only.
				progress.total = manifest.segments.length;
				for (const segRef of manifest.segments) {
					const segBytes = await resolved.storage.download(segRef.id);

					const seg = JSON.parse(new TextDecoder().decode(segBytes)) as Segment;
					if (!seg.chunks || !Array.isArray(seg.chunks)) {
						throw new Error(
							`Pulled segment ${segRef.id} is not a valid Segment (missing chunks[]). Refusing to save corrupt collection.`,
						);
					}

					const uploadResult = await store.storage.upload(segBytes);
					if (uploadResult.id !== segRef.id) {
						throw new Error(
							`Hash mismatch pulling segment ${segRef.id}: local storage produced id ${uploadResult.id}. Pulled bytes do not match the manifest's segment identity — refusing to save corrupt collection.`,
						);
					}
					progress.downloaded += 1;
					progress.byKind.segment += 1;

					if (format === "human" && progress.downloaded % 50 === 0) {
						console.error(`   ${progress.downloaded}/${progress.total} segments downloaded...`);
					}
				}
			}

			await store.manifests.putHead(name, manifest, null);

			if (format === "human") {
				console.error(
					`\n✅ Pulled "${name}" — ${manifest.totalChunks} chunks in ${progress.byKind.segment} segments` +
						describeNonSegmentKinds(progress.byKind),
				);
				console.error(
					`   Embedding model: ${manifest.embeddingModel} (${manifest.embeddingDimensions}d)`,
				);
				console.error(`\n   Query with:`);
				console.error(
					`   wtfoc query "your question" -c ${name} --embedder api --embedder-url ollama --embedder-model ${manifest.embeddingModel}`,
				);
			}

			if (format === "json") {
				console.log(
					JSON.stringify({
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
}): Promise<void> {
	const { refs, resolved, store, manifestDir, collectionName, format, progress } = args;

	progress.total = refs.length;

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
				const uploadResult = await store.storage.upload(bytes);
				if (uploadResult.id !== ref.storageId) {
					throw new Error(
						`Hash mismatch pulling ${describeRef(ref)}: local storage produced id ${uploadResult.id}, manifest expects ${ref.storageId}. Pulled bytes do not match the manifest's artifact identity — refusing to save corrupt collection.`,
					);
				}
				if (ref.kind === "raw-source-blob") {
					// Manifest also records sha256 for raw-source-blobs; re-verify.
					const actualSha = sha256Hex(bytes);
					if (actualSha !== ref.sha256) {
						throw new Error(
							`SHA-256 mismatch pulling raw-source blob ${ref.storageId}: expected ${ref.sha256}, got ${actualSha}.`,
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
				await writeSidecar({
					role: ref.role,
					bytes,
					manifestDir,
					collectionName,
				});
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
			console.error(`   ${progress.downloaded}/${progress.total} artifacts downloaded...`);
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
			// storage is a storage-id → ipfsCid indirection backed by verified-fetch.
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

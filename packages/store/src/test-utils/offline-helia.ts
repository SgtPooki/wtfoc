import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsBlockstore } from "blockstore-fs";
import { FsDatastore } from "datastore-fs";
import { createHelia, type Helia, type HeliaInit } from "helia";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";

/**
 * An offline-capable Helia node for tests. Publish bytes via `publishBytes()`
 * to obtain a CID, then retrieve through `createVerifiedFetch(node.helia)` in
 * test code.
 *
 * IMPORTANT: the offline guarantee is NOT structural in this harness alone.
 * Helia's default block brokers include `trustlessGateway` (public HTTP) and
 * we keep the defaults because removing them also disables local-blockstore
 * reads through verified-fetch's pipeline (verified-fetch returns `501` with
 * an empty broker list). The offline guarantee comes from installing a
 * `globalThis.fetch` guard in the test harness (`beforeEach`) that throws
 * synchronously — any attempted HTTP call fails immediately, so a CID miss
 * cannot leak to a public gateway. See `offline-helia.test.ts` for the
 * canonical setup pattern.
 */
export interface OfflineHelia {
	helia: Helia;
	/** Directory holding blockstore + datastore. Removed by `cleanup()`. */
	rootDir: string;
	/** Add raw bytes to the local blockstore and return the resulting CID. */
	publishBytes(bytes: Uint8Array): Promise<CID>;
	/** Stop Helia and remove the backing filesystem dirs. */
	cleanup(): Promise<void>;
}

/**
 * Create a Helia node backed by filesystem blockstore + datastore in a
 * tempdir. libp2p is never started (`start: false`) so bitswap can't dial.
 * See the `OfflineHelia` docstring for the complete offline story.
 */
export async function createOfflineHelia(): Promise<OfflineHelia> {
	const rootDir = await mkdtemp(join(tmpdir(), "wtfoc-test-helia-"));
	const blockstore = new FsBlockstore(join(rootDir, "blocks"));
	const datastore = new FsDatastore(join(rootDir, "data"));

	await blockstore.open();
	await datastore.open();

	// The interface-{block,data}store types in Helia 6 and in {blockstore,datastore}-fs
	// are structurally identical but come from duplicate installs under pnpm (peer-dep
	// semver ranges allow both 9.0.2 and 9.0.3 of interface-datastore). Cast to the
	// HeliaInit-expected types once at the boundary — runtime behavior is unaffected.
	const helia = await createHelia({
		blockstore: blockstore as HeliaInit["blockstore"],
		datastore: datastore as HeliaInit["datastore"],
		start: false,
	});

	async function publishBytes(bytes: Uint8Array): Promise<CID> {
		const hash = await sha256.digest(bytes);
		const cid = CID.create(1, raw.code, hash);
		await helia.blockstore.put(cid, bytes);
		return cid;
	}

	async function cleanup(): Promise<void> {
		// Swallow teardown errors so one bad close can't mask a real test failure
		// AND can't block the tempdir removal. The tempdir cleanup below is what
		// actually matters — the blockstore/datastore/helia state is discarded
		// with it either way.
		try {
			await helia.stop();
		} catch {}
		try {
			await blockstore.close();
		} catch {}
		try {
			await datastore.close();
		} catch {}
		await rm(rootDir, { recursive: true, force: true });
	}

	return { helia, rootDir, publishBytes, cleanup };
}

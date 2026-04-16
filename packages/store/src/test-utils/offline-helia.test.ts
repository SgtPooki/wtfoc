import { createVerifiedFetch } from "@helia/verified-fetch";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { CidReadableStorage } from "../backends/cid-reader.js";
import { createOfflineHelia, type OfflineHelia } from "./offline-helia.js";

describe("offline Helia infrastructure", () => {
	let node: OfflineHelia;
	let fetchGuard: MockInstance<typeof globalThis.fetch>;

	beforeEach(async () => {
		node = await createOfflineHelia();
		// Structural offline enforcement: any attempt to touch the network fails
		// immediately. Local blockstore reads don't use globalThis.fetch, so they
		// still succeed. A CID miss that tries to reach trustlessGateway (the
		// default HTTP broker in Helia 6) throws here instead of leaking out.
		fetchGuard = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			throw new Error(
				`network must not be touched in offline harness (attempted fetch: ${String(input)})`,
			);
		});
	});

	afterEach(async () => {
		fetchGuard.mockRestore();
		await node.cleanup();
	});

	it("publishes raw bytes and retrieves them via CidReadableStorage", async () => {
		const bytes = new TextEncoder().encode("hello wtfoc — offline helia round-trip");
		const cid = await node.publishBytes(bytes);

		const verifiedFetch = await createVerifiedFetch(node.helia);
		const reader = new CidReadableStorage({ verifiedFetch });

		const retrieved = await reader.download(cid.toString());

		expect(retrieved).toEqual(bytes);
		expect(fetchGuard).not.toHaveBeenCalled();
	});

	it("retrieves distinct content for distinct CIDs", async () => {
		const alpha = new TextEncoder().encode("alpha");
		const beta = new TextEncoder().encode("beta");
		const cidAlpha = await node.publishBytes(alpha);
		const cidBeta = await node.publishBytes(beta);

		expect(cidAlpha.toString()).not.toBe(cidBeta.toString());

		const verifiedFetch = await createVerifiedFetch(node.helia);
		const reader = new CidReadableStorage({ verifiedFetch });

		expect(await reader.download(cidAlpha.toString())).toEqual(alpha);
		expect(await reader.download(cidBeta.toString())).toEqual(beta);
		expect(fetchGuard).not.toHaveBeenCalled();
	});

	it("survives large-ish payloads (10KB) through the round-trip", async () => {
		const bytes = new Uint8Array(10 * 1024);
		for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
		const cid = await node.publishBytes(bytes);

		const verifiedFetch = await createVerifiedFetch(node.helia);
		const reader = new CidReadableStorage({ verifiedFetch });

		const retrieved = await reader.download(cid.toString());
		expect(retrieved).toEqual(bytes);
		expect(fetchGuard).not.toHaveBeenCalled();
	});

	it("fails loudly for unpublished CIDs without leaking to the network", async () => {
		// Compute a CID for bytes that were never published to the node. A miss
		// may reach trustlessGateway's HTTP path — the fetch guard converts any
		// such attempt into a synchronous throw, proving no actual network hit.
		const unpublished = new TextEncoder().encode("never published");
		const hash = await sha256.digest(unpublished);
		const unknownCid = CID.create(1, raw.code, hash);

		const verifiedFetch = await createVerifiedFetch(node.helia);
		const reader = new CidReadableStorage({ verifiedFetch });

		await expect(reader.download(unknownCid.toString())).rejects.toThrow();
		// If fetch was attempted, the guard already threw. If it wasn't attempted,
		// the pipeline errored on its own. Either way, no real network traffic.
	});
});

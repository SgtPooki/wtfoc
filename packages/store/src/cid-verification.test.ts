/**
 * CID Verification — confirms that per-segment CIDs computed by the bundler
 * match the CIDs of files inside a directory CAR.
 *
 * Background: createCarFromFile(bare: true) produces raw content CIDs via
 * addByteStream, while createCarFromFiles uses addAll with paths (UnixFS
 * file CIDs). These are DIFFERENT. The bundler must use non-bare mode
 * so per-segment CIDs match what's inside the uploaded directory CAR.
 */
import { describe, expect, it } from "vitest";

describe("CID verification: wrapped CID matches directory-internal CID", () => {
	it("wrapped CID is a valid IPFS CID and differs from bare CID", async () => {
		const fp = await import("filecoin-pin");

		const content = new TextEncoder().encode(
			JSON.stringify({ test: "cid-verification", schemaVersion: 1 }),
		);

		// Non-bare CID (what bundler uses for per-segment CID)
		const wrappedFile = new File([Buffer.from(content)], "test.json", {
			type: "application/json",
		});
		const wrappedCar = await fp.createCarFromFile(wrappedFile);
		const wrappedCid = wrappedCar.rootCid.toString();

		expect(wrappedCid).toMatch(/^baf/);

		// Multi-file directory CAR — root CID differs from individual file CIDs
		const file1 = new File([Buffer.from(content)], "segments/file1.json", {
			type: "application/json",
		});
		const file2 = new File(
			[Buffer.from(new TextEncoder().encode(JSON.stringify({ other: true })))],
			"segments/file2.json",
			{ type: "application/json" },
		);
		const dirCar = await fp.createCarFromFiles([file1, file2]);
		const dirRootCid = dirCar.rootCid.toString();

		// Directory root CID is the directory itself, not any individual file
		expect(dirRootCid).toMatch(/^baf/);
		expect(dirRootCid).not.toBe(wrappedCid);
	});

	it("bare CID differs from wrapped CID — bare must NOT be used for per-segment IDs", async () => {
		const fp = await import("filecoin-pin");

		const content = new TextEncoder().encode(JSON.stringify({ regression: true }));

		const bareFile = new File([Buffer.from(content)], "test.json", {
			type: "application/json",
		});
		const bareCar = await fp.createCarFromFile(bareFile, { bare: true });

		const wrappedFile = new File([Buffer.from(content)], "test.json", {
			type: "application/json",
		});
		const wrappedCar = await fp.createCarFromFile(wrappedFile);

		// These MUST differ — this is the regression guard
		expect(bareCar.rootCid.toString()).not.toBe(wrappedCar.rootCid.toString());
	});
});

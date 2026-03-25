/**
 * CID Verification — confirms that per-segment CIDs computed by the bundler
 * (bare mode = raw content CIDs) match the actual blocks inside a directory CAR.
 *
 * Background: createCarFromFile({ bare: true }) produces raw content CIDs that
 * match the content blocks inside directory CARs built by createCarFromFiles.
 * Non-bare (wrapped) mode adds a directory wrapper node whose CID does NOT
 * appear in the directory CAR — that was the root cause of issue #139.
 */
import { CarBlockIterator } from "@ipld/car";
import { describe, expect, it } from "vitest";

describe("CID verification: bare CIDs match directory CAR blocks", () => {
	it("bare CIDs appear as blocks in the directory CAR", async () => {
		const fp = await import("filecoin-pin");

		const content1 = new TextEncoder().encode(JSON.stringify({ seg: "one", schemaVersion: 1 }));
		const content2 = new TextEncoder().encode(JSON.stringify({ seg: "two", schemaVersion: 1 }));

		// Compute per-segment CIDs using bare mode (what bundler now uses)
		const bareCar1 = await fp.createCarFromFile(
			new File([Buffer.from(content1)], "seg-1.json", { type: "application/json" }),
			{ bare: true },
		);
		const bareCar2 = await fp.createCarFromFile(
			new File([Buffer.from(content2)], "seg-2.json", { type: "application/json" }),
			{ bare: true },
		);

		// Build directory CAR (same as bundler step 2)
		const dirCar = await fp.createCarFromFiles([
			new File([Buffer.from(content1)], "segments/seg-1.json", { type: "application/json" }),
			new File([Buffer.from(content2)], "segments/seg-2.json", { type: "application/json" }),
		]);

		// Walk all blocks in the directory CAR
		const blockCids = new Set<string>();
		const iterator = await CarBlockIterator.fromBytes(dirCar.carBytes);
		for await (const block of iterator) {
			blockCids.add(block.cid.toString());
		}

		// Bare CIDs MUST appear as blocks — this is the fix for #139
		expect(blockCids.has(bareCar1.rootCid.toString())).toBe(true);
		expect(blockCids.has(bareCar2.rootCid.toString())).toBe(true);
	});

	it("wrapped (non-bare) CIDs do NOT appear in directory CAR — regression guard", async () => {
		const fp = await import("filecoin-pin");

		const content = new TextEncoder().encode(JSON.stringify({ seg: "one", schemaVersion: 1 }));

		// Wrapped CID (the old broken approach)
		const wrappedCar = await fp.createCarFromFile(
			new File([Buffer.from(content)], "seg-1.json", { type: "application/json" }),
		);

		// Directory CAR
		const dirCar = await fp.createCarFromFiles([
			new File([Buffer.from(content)], "segments/seg-1.json", { type: "application/json" }),
			new File(
				[Buffer.from(new TextEncoder().encode(JSON.stringify({ other: true })))],
				"segments/seg-2.json",
				{ type: "application/json" },
			),
		]);

		const blockCids = new Set<string>();
		const iterator = await CarBlockIterator.fromBytes(dirCar.carBytes);
		for await (const block of iterator) {
			blockCids.add(block.cid.toString());
		}

		// Wrapped CID must NOT be in the directory CAR — this was the #139 bug
		expect(blockCids.has(wrappedCar.rootCid.toString())).toBe(false);
	});

	it("bare CID differs from wrapped CID", async () => {
		const fp = await import("filecoin-pin");

		const content = new TextEncoder().encode(JSON.stringify({ regression: true }));

		const bareCar = await fp.createCarFromFile(
			new File([Buffer.from(content)], "test.json", { type: "application/json" }),
			{ bare: true },
		);

		const wrappedCar = await fp.createCarFromFile(
			new File([Buffer.from(content)], "test.json", { type: "application/json" }),
		);

		expect(bareCar.rootCid.toString()).not.toBe(wrappedCar.rootCid.toString());
	});
});

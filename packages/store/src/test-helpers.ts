import { WtfocError } from "@wtfoc/common";
import { expect } from "vitest";

/** Asserts that `fn` throws a {@link WtfocError} with the given `code`. */
export function expectWtfocCode(fn: () => void, code: string): void {
	let threw = false;
	try {
		fn();
	} catch (e) {
		threw = true;
		expect(e).toBeInstanceOf(WtfocError);
		expect((e as WtfocError).code).toBe(code);
	}
	expect(threw).toBe(true);
}

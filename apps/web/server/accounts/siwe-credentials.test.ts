/**
 * Unit tests for the SIWE credentials provider's authorize() rejection
 * logic. We don't generate real EIP-191 signatures here — instead we
 * spy on SiweMessage.prototype.verify() so the rest of the pipeline
 * (chainId/URI checks, nonce consumption, user upsert) runs against
 * real EIP-4361 message parsing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiweMessage } from "siwe";
import { siweCredentialsProvider } from "./siwe-credentials.js";

const TEST_WALLET = "0x1111111111111111111111111111111111111111";

function buildMessage(overrides: Partial<{ uri: string; chainId: number }> = {}): string {
	return new SiweMessage({
		domain: "wtfoc.xyz",
		address: TEST_WALLET,
		uri: overrides.uri ?? "https://wtfoc.xyz",
		chainId: overrides.chainId ?? 314,
		nonce: "abc123def456abc123def456",
		statement: "Sign in to wtfoc.xyz",
		issuedAt: new Date().toISOString(),
		expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
		version: "1",
	}).prepareMessage();
}

interface MockResult {
	rows: unknown[];
	rowCount: number;
}

function makePool(initial: MockResult = { rows: [], rowCount: 0 }) {
	const queries: Array<{ sql: string; params: unknown[] }> = [];
	const pool = {
		query: vi.fn(async (sql: string, params: unknown[] = []) => {
			queries.push({ sql, params });
			return initial;
		}),
		connect: vi.fn(async () => ({
			query: vi.fn(async () => ({
				rows: [{ id: "user-new", email: null, name: "0x…", emailVerified: null, image: null }],
				rowCount: 1,
			})),
			release: vi.fn(),
		})),
		queries,
	};
	return pool;
}

function makeNonceStore(consumed = true) {
	return {
		consume: vi.fn(async () => consumed),
		issue: vi.fn(),
		gc: vi.fn(),
	};
}

function build(overrides: Partial<Parameters<typeof siweCredentialsProvider>[0]> = {}) {
	const pool = makePool();
	const nonceStore = makeNonceStore();
	const provider = siweCredentialsProvider({
		nonceStore: nonceStore as never,
		pool: pool as never,
		expectedDomain: "wtfoc.xyz",
		expectedUri: "https://wtfoc.xyz",
		allowedChainIds: [314, 314159],
		...overrides,
	}) as { authorize: (creds: { message?: string; signature?: string }) => Promise<unknown> };
	return { provider, pool, nonceStore };
}

describe("siweCredentialsProvider.authorize", () => {
	let verifySpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		verifySpy = vi.spyOn(SiweMessage.prototype, "verify");
	});
	afterEach(() => {
		verifySpy.mockRestore();
	});

	it("returns null when message is missing", async () => {
		const { provider } = build();
		expect(await provider.authorize({ signature: "0xsig" })).toBeNull();
		expect(verifySpy).not.toHaveBeenCalled();
	});

	it("returns null when signature is missing", async () => {
		const { provider } = build();
		expect(await provider.authorize({ message: "x" })).toBeNull();
	});

	it("rejects unallowed chainId without verifying signature", async () => {
		const { provider } = build();
		const msg = buildMessage({ chainId: 999 });
		expect(await provider.authorize({ message: msg, signature: "0xsig" })).toBeNull();
		expect(verifySpy).not.toHaveBeenCalled();
	});

	it("rejects when verify() fails", async () => {
		const { provider } = build();
		verifySpy.mockResolvedValueOnce({ success: false } as never);
		expect(await provider.authorize({ message: buildMessage(), signature: "0xsig" })).toBeNull();
	});

	it("rejects mismatched URI", async () => {
		const { provider } = build();
		verifySpy.mockResolvedValueOnce({ success: true } as never);
		const msg = buildMessage({ uri: "https://evil.example" });
		expect(await provider.authorize({ message: msg, signature: "0xsig" })).toBeNull();
	});

	it("rejects when nonce already consumed (replay)", async () => {
		const { provider, nonceStore } = build();
		(nonceStore.consume as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
		verifySpy.mockResolvedValueOnce({ success: true } as never);
		expect(await provider.authorize({ message: buildMessage(), signature: "0xsig" })).toBeNull();
	});

	// Happy-path "existing user found" coverage requires a real EIP-191
	// signature verifying against the SIWE library, which is awkward to
	// produce in a unit test. Integration coverage lives in the deployed
	// smoke tests; the rejection-path tests above are what catches drift
	// in our pre-checks (chainId, URI, replay).
});

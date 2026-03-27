import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodePrivateKey, signGitHubAppJwt } from "./jwt.js";

// Generate a test RSA key pair (never leaves this test file)
const { privateKey: TEST_PEM, publicKey: TEST_PUBLIC_PEM } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function decodeJwtPart(part: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("signGitHubAppJwt", () => {
	it("produces a valid three-part JWT", () => {
		const jwt = signGitHubAppJwt({ appId: "12345", privateKey: TEST_PEM });
		const parts = jwt.split(".");
		expect(parts).toHaveLength(3);
	});

	it("sets correct header", () => {
		const jwt = signGitHubAppJwt({ appId: "12345", privateKey: TEST_PEM });
		const header = decodeJwtPart(jwt.split(".")[0] ?? "");
		expect(header.alg).toBe("RS256");
		expect(header.typ).toBe("JWT");
	});

	it("sets correct payload claims", () => {
		const jwt = signGitHubAppJwt({ appId: "42", privateKey: TEST_PEM });
		const payload = decodeJwtPart(jwt.split(".")[1] ?? "");

		expect(payload.iss).toBe("42");
		expect(typeof payload.iat).toBe("number");
		expect(typeof payload.exp).toBe("number");

		const now = Math.floor(Date.now() / 1000);
		// iat should be ~60s in the past (clock drift)
		expect(payload.iat as number).toBeLessThanOrEqual(now);
		expect(payload.iat as number).toBeGreaterThan(now - 120);
		// exp should be ~10min in the future
		expect(payload.exp as number).toBeGreaterThan(now + 500);
		expect(payload.exp as number).toBeLessThanOrEqual(now + 660);
	});

	it("respects custom expiresInSeconds", () => {
		const jwt = signGitHubAppJwt({ appId: "1", privateKey: TEST_PEM, expiresInSeconds: 120 });
		const payload = decodeJwtPart(jwt.split(".")[1] ?? "");
		const now = Math.floor(Date.now() / 1000);
		expect(payload.exp as number).toBeLessThanOrEqual(now + 180);
		expect(payload.exp as number).toBeGreaterThan(now + 60);
	});

	it("signature verifies with the matching public key", () => {
		const jwt = signGitHubAppJwt({ appId: "99", privateKey: TEST_PEM });
		const [headerB64, payloadB64, signatureB64] = jwt.split(".");
		const signingInput = `${headerB64}.${payloadB64}`;
		const signature = Buffer.from(signatureB64 ?? "", "base64url");

		const verifier = createVerify("RSA-SHA256");
		verifier.update(signingInput);
		expect(verifier.verify(TEST_PUBLIC_PEM, signature)).toBe(true);
	});
});

describe("decodePrivateKey", () => {
	it("passes through raw PEM unchanged", () => {
		expect(decodePrivateKey(TEST_PEM)).toBe(TEST_PEM);
	});

	it("decodes base64-encoded PEM", () => {
		const encoded = Buffer.from(TEST_PEM, "utf8").toString("base64");
		expect(decodePrivateKey(encoded)).toBe(TEST_PEM);
	});
});

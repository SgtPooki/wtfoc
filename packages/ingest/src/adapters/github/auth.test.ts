import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubAppTokenProvider, GitHubOAuthTokenProvider, PatTokenProvider } from "./auth.js";

const { privateKey: TEST_PEM } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

describe("PatTokenProvider", () => {
	it("returns the static token", async () => {
		const provider = new PatTokenProvider("ghp_test123");
		expect(await provider.getToken()).toBe("ghp_test123");
	});

	it("returns the same token on repeated calls", async () => {
		const provider = new PatTokenProvider("ghp_abc");
		expect(await provider.getToken()).toBe("ghp_abc");
		expect(await provider.getToken()).toBe("ghp_abc");
	});
});

describe("GitHubAppTokenProvider", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		mockFetch.mockReset();
		vi.stubGlobal("fetch", mockFetch);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function makeProvider() {
		return new GitHubAppTokenProvider({
			appId: "12345",
			privateKey: TEST_PEM,
			installationId: 99,
		});
	}

	function mockInstallationTokenResponse(token: string, expiresInMinutes = 60) {
		const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ token, expires_at: expiresAt }),
		});
	}

	it("fetches an installation token", async () => {
		const provider = makeProvider();
		mockInstallationTokenResponse("ghs_install_token_1");

		const token = await provider.getToken();
		expect(token).toBe("ghs_install_token_1");
		expect(mockFetch).toHaveBeenCalledOnce();

		const [url, opts] = mockFetch.mock.calls[0] ?? [];
		expect(url).toBe("https://api.github.com/app/installations/99/access_tokens");
		expect(opts.method).toBe("POST");
		expect(opts.headers.Authorization).toMatch(/^Bearer /);
	});

	it("caches the token on subsequent calls", async () => {
		const provider = makeProvider();
		mockInstallationTokenResponse("ghs_cached");

		await provider.getToken();
		await provider.getToken();
		await provider.getToken();
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it("refreshes when token is near expiry", async () => {
		const provider = makeProvider();
		// First token expires in 3 minutes (< 5 min buffer → will refresh)
		mockInstallationTokenResponse("ghs_expiring", 3);
		await provider.getToken();

		// Second call should fetch a new token
		mockInstallationTokenResponse("ghs_fresh", 60);
		const token = await provider.getToken();
		expect(token).toBe("ghs_fresh");
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("throws on API error", async () => {
		const provider = makeProvider();
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			text: async () => "Bad credentials",
		});

		await expect(provider.getToken()).rejects.toThrow("GitHub App token request failed: 401");
	});
});

describe("GitHubOAuthTokenProvider", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		mockFetch.mockReset();
		vi.stubGlobal("fetch", mockFetch);
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function makeProvider() {
		return new GitHubOAuthTokenProvider({
			clientId: "Iv1.test_client_id",
			clientSecret: "test_client_secret",
		});
	}

	function mockOAuthResponse(accessToken: string, refreshToken: string, expiresIn = 28800) {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				access_token: accessToken,
				refresh_token: refreshToken,
				expires_in: expiresIn,
			}),
		});
	}

	it("throws when no token is available", async () => {
		const provider = makeProvider();
		await expect(provider.getToken()).rejects.toThrow("No OAuth token available");
	});

	it("exchanges code for tokens", async () => {
		const provider = makeProvider();
		mockOAuthResponse("ghu_access_1", "ghr_refresh_1");

		const data = await provider.exchangeCode("code_abc");
		expect(data.accessToken).toBe("ghu_access_1");
		expect(data.refreshToken).toBe("ghr_refresh_1");
		expect(data.expiresAt).toBeGreaterThan(Date.now());

		const [url, opts] = mockFetch.mock.calls[0] ?? [];
		expect(url).toBe("https://github.com/login/oauth/access_token");
		const body = JSON.parse(opts.body);
		expect(body.client_id).toBe("Iv1.test_client_id");
		expect(body.code).toBe("code_abc");
	});

	it("returns access token after exchange", async () => {
		const provider = makeProvider();
		mockOAuthResponse("ghu_access_2", "ghr_refresh_2");
		await provider.exchangeCode("code_xyz");

		const token = await provider.getToken();
		expect(token).toBe("ghu_access_2");
		// No additional fetch — token is cached
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it("refreshes expired token automatically", async () => {
		const provider = makeProvider();
		// Token that expires in 1 second (will be "near expiry" immediately)
		mockOAuthResponse("ghu_old", "ghr_refresh_old", 1);
		await provider.exchangeCode("code_1");

		// Wait for it to be considered near-expiry
		mockOAuthResponse("ghu_new", "ghr_refresh_new", 28800);
		const token = await provider.getToken();
		expect(token).toBe("ghu_new");
		expect(mockFetch).toHaveBeenCalledTimes(2);

		// Verify refresh request
		const [, opts] = mockFetch.mock.calls[1] ?? [];
		const body = JSON.parse(opts.body);
		expect(body.grant_type).toBe("refresh_token");
		expect(body.refresh_token).toBe("ghr_refresh_old");
	});

	it("can be initialized with existing token data", async () => {
		const provider = new GitHubOAuthTokenProvider(
			{ clientId: "id", clientSecret: "secret" },
			{
				accessToken: "ghu_existing",
				refreshToken: "ghr_existing",
				expiresAt: Date.now() + 3600_000,
			},
		);

		const token = await provider.getToken();
		expect(token).toBe("ghu_existing");
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("getTokenData returns a copy of the current tokens", async () => {
		const provider = makeProvider();
		expect(provider.getTokenData()).toBeNull();

		mockOAuthResponse("ghu_data", "ghr_data");
		await provider.exchangeCode("code_data");

		const data = provider.getTokenData();
		expect(data).not.toBeNull();
		expect(data?.accessToken).toBe("ghu_data");
		expect(data?.refreshToken).toBe("ghr_data");
	});

	it("throws on GitHub OAuth error response", async () => {
		const provider = makeProvider();
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				error: "bad_verification_code",
				error_description: "The code passed is incorrect or expired.",
			}),
		});

		await expect(provider.exchangeCode("bad_code")).rejects.toThrow("bad_verification_code");
	});
});

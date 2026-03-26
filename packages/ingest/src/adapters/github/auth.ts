/**
 * GitHub token providers for different auth strategies.
 *
 * Common interface so the HTTP transport (from spec 121) can accept
 * any provider: PAT for MVP, GitHub App installation tokens or
 * per-user OAuth tokens post-MVP.
 */

import { signGitHubAppJwt } from "./jwt.js";

const GITHUB_API = "https://api.github.com";

/** Common interface for all GitHub token providers. */
export interface GitHubTokenProvider {
	getToken(signal?: AbortSignal): Promise<string>;
}

// ── PAT ───────────────────────────────────────────────────────────

/** Wraps a static Personal Access Token. No refresh logic needed. */
export class PatTokenProvider implements GitHubTokenProvider {
	readonly #token: string;

	constructor(token: string) {
		this.#token = token;
	}

	async getToken(_signal?: AbortSignal): Promise<string> {
		return this.#token;
	}
}

// ── GitHub App Installation Token ─────────────────────────────────

export interface GitHubAppConfig {
	/** GitHub App ID (numeric string) */
	appId: string;
	/** PEM-encoded RSA private key (or base64-encoded PEM) */
	privateKey: string;
	/** Installation ID (numeric) — from the app's installation on a user/org */
	installationId: number;
}

interface CachedToken {
	token: string;
	expiresAt: number;
}

/**
 * Generates installation access tokens from a GitHub App's private key.
 *
 * Flow: sign JWT → POST /app/installations/{id}/access_tokens → cache token.
 * Installation tokens last 1 hour. We refresh 5 minutes before expiry.
 */
export class GitHubAppTokenProvider implements GitHubTokenProvider {
	readonly #config: GitHubAppConfig;
	#cached: CachedToken | null = null;

	constructor(config: GitHubAppConfig) {
		this.#config = config;
	}

	async getToken(signal?: AbortSignal): Promise<string> {
		if (this.#cached && Date.now() < this.#cached.expiresAt - 5 * 60 * 1000) {
			return this.#cached.token;
		}

		const jwt = signGitHubAppJwt({
			appId: this.#config.appId,
			privateKey: this.#config.privateKey,
		});

		const response = await fetch(
			`${GITHUB_API}/app/installations/${this.#config.installationId}/access_tokens`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${jwt}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
				signal,
			},
		);

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(
				`GitHub App token request failed: ${response.status} ${response.statusText} ${body}`,
			);
		}

		const data = (await response.json()) as { token: string; expires_at: string };
		this.#cached = {
			token: data.token,
			expiresAt: new Date(data.expires_at).getTime(),
		};

		return data.token;
	}
}

// ── OAuth User Token ──────────────────────────────────────────────

export interface GitHubOAuthConfig {
	/** GitHub App's client ID */
	clientId: string;
	/** GitHub App's client secret */
	clientSecret: string;
}

export interface GitHubOAuthTokenData {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

/**
 * Manages per-user OAuth tokens from the GitHub App's OAuth flow.
 *
 * Handles:
 * - Exchanging an authorization code for an access + refresh token
 * - Refreshing expired tokens automatically on getToken()
 * - Token caching with expiry-aware refresh
 *
 * The OAuth callback handler (in the web server, spec 121 territory)
 * calls exchangeCode() and stores the result. This provider then
 * manages refresh transparently.
 */
export class GitHubOAuthTokenProvider implements GitHubTokenProvider {
	readonly #config: GitHubOAuthConfig;
	#tokenData: GitHubOAuthTokenData | null = null;

	constructor(config: GitHubOAuthConfig, initialToken?: GitHubOAuthTokenData) {
		this.#config = config;
		this.#tokenData = initialToken ?? null;
	}

	/** Exchange an OAuth authorization code for access + refresh tokens. */
	async exchangeCode(code: string, signal?: AbortSignal): Promise<GitHubOAuthTokenData> {
		const response = await fetch("https://github.com/login/oauth/access_token", {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				client_id: this.#config.clientId,
				client_secret: this.#config.clientSecret,
				code,
			}),
			signal,
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`GitHub OAuth code exchange failed: ${response.status} ${body}`);
		}

		const data = (await response.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
			error?: string;
			error_description?: string;
		};

		if (data.error) {
			throw new Error(`GitHub OAuth error: ${data.error} — ${data.error_description}`);
		}

		this.#tokenData = {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: Date.now() + data.expires_in * 1000,
		};

		return this.#tokenData;
	}

	async getToken(signal?: AbortSignal): Promise<string> {
		if (!this.#tokenData) {
			throw new Error("No OAuth token available. Call exchangeCode() first.");
		}

		// Refresh 5 minutes before expiry
		if (Date.now() >= this.#tokenData.expiresAt - 5 * 60 * 1000) {
			await this.#refresh(signal);
		}

		return this.#tokenData.accessToken;
	}

	/** Get the current token data (for persistence by the caller). */
	getTokenData(): GitHubOAuthTokenData | null {
		return this.#tokenData ? { ...this.#tokenData } : null;
	}

	async #refresh(signal?: AbortSignal): Promise<void> {
		if (!this.#tokenData?.refreshToken) {
			throw new Error("No refresh token available. User must re-authorize.");
		}

		const response = await fetch("https://github.com/login/oauth/access_token", {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				client_id: this.#config.clientId,
				client_secret: this.#config.clientSecret,
				grant_type: "refresh_token",
				refresh_token: this.#tokenData.refreshToken,
			}),
			signal,
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`GitHub OAuth token refresh failed: ${response.status} ${body}`);
		}

		const data = (await response.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
			error?: string;
			error_description?: string;
		};

		if (data.error) {
			throw new Error(`GitHub OAuth refresh error: ${data.error} — ${data.error_description}`);
		}

		this.#tokenData = {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: Date.now() + data.expires_in * 1000,
		};
	}
}

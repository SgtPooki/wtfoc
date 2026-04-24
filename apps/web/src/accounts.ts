/**
 * Auth.js client for wtfoc accounts flow (phase 2+3 of wtfoc-p6at).
 * Thin wrapper over /api/accounts/* — no @auth/react or @auth/preact
 * because we don't have that framework helper available and the surface
 * is small enough to roll directly.
 */

import { signal } from "@preact/signals";

export interface SessionUser {
	id: string;
	email: string | null;
	name: string | null;
	image: string | null;
}

export interface Session {
	user: SessionUser;
	expires: string;
}

/** Current Auth.js session (null = anonymous, undefined = still loading). */
export const session = signal<Session | null | undefined>(undefined);

const BASE = "/api/accounts";

async function getCsrfToken(): Promise<string> {
	const res = await fetch(`${BASE}/csrf`, { credentials: "same-origin" });
	if (!res.ok) throw new Error(`csrf ${res.status}`);
	const data = (await res.json()) as { csrfToken: string };
	return data.csrfToken;
}

/** Fetch current session from server. Called once on boot. */
export async function fetchAccountSession(): Promise<Session | null> {
	const res = await fetch(`${BASE}/session`, { credentials: "same-origin" });
	if (!res.ok) return null;
	const body = (await res.json()) as Session | Record<string, never> | null;
	if (!body || !("user" in body)) return null;
	return body as Session;
}

/**
 * Initiate Resend magic-link sign-in. Server emails the user; UI shows
 * "check your inbox". Auth.js redirects to /api/accounts/verify-request
 * on success, which (per the config's `pages.verifyRequest`) redirects
 * to /login?check-email=1.
 */
export async function signInWithEmail(email: string, callbackUrl = "/account"): Promise<void> {
	const csrfToken = await getCsrfToken();
	const body = new URLSearchParams({
		csrfToken,
		email,
		callbackUrl,
		json: "true",
	});
	const res = await fetch(`${BASE}/signin/resend`, {
		method: "POST",
		credentials: "same-origin",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`signin failed: ${res.status} ${text}`);
	}
}

export async function signOut(): Promise<void> {
	const csrfToken = await getCsrfToken();
	const body = new URLSearchParams({ csrfToken, callbackUrl: "/", json: "true" });
	const res = await fetch(`${BASE}/signout`, {
		method: "POST",
		credentials: "same-origin",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});
	if (!res.ok) throw new Error(`signout failed: ${res.status}`);
	session.value = null;
}

/** Boot — populate session signal. */
export function bootAccountSession(): void {
	fetchAccountSession()
		.then((s) => {
			session.value = s;
		})
		.catch(() => {
			session.value = null;
		});
}

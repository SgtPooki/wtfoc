/**
 * Minimal client-side router for wtfoc. No dependency — signal-driven.
 * Server serves index.html for any extensionless path (SPA fallback),
 * so we just read window.location.pathname and react.
 *
 * Known routes: "/", "/login", "/account", "/app". Unknown paths fall
 * through to the existing wallet/search app.
 */

import { signal } from "@preact/signals";

function currentPath(): string {
	return window.location.pathname || "/";
}

export const route = signal(currentPath());

/** Navigate in-app without full reload. */
export function navigate(path: string, replace = false): void {
	if (replace) window.history.replaceState(null, "", path);
	else window.history.pushState(null, "", path);
	route.value = path;
}

window.addEventListener("popstate", () => {
	route.value = currentPath();
});

/**
 * One-time migration for bookmarked trace URLs: if the user lands on `/`
 * with a ?q= or ?collection= param, assume they meant the existing app
 * and forward them to `/app` preserving query. Prevents the landing
 * rewrite from breaking existing links.
 */
if (route.value === "/") {
	const sp = new URLSearchParams(window.location.search);
	if (sp.has("q") || sp.has("collection")) {
		const qs = sp.toString();
		const target = qs ? `/app?${qs}` : "/app";
		window.history.replaceState(null, "", target);
		route.value = "/app";
	}
}

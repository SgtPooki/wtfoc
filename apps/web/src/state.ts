import { effect, signal } from "@preact/signals";

function getParam(key: string): string {
	return new URLSearchParams(window.location.search).get(key) ?? "";
}

/** Live text in the search input */
export const draftQuery = signal(getParam("q"));

/** Submitted query currently driving results */
export const activeQuery = signal(getParam("q"));

/** Current view mode */
export const mode = signal<"trace" | "search">(getParam("mode") === "search" ? "search" : "trace");

/** Selected collection name */
export const collection = signal(getParam("collection"));

/** Whether a search/trace request is in-flight */
export const loading = signal(false);

/** Current AbortController for cancelling in-flight requests */
let currentAbort: AbortController | null = null;

export function getAbortSignal(): AbortSignal {
	if (currentAbort) {
		currentAbort.abort();
	}
	currentAbort = new AbortController();
	return currentAbort.signal;
}

export function cancelRequest(): void {
	if (currentAbort) {
		currentAbort.abort();
		currentAbort = null;
	}
}

/** Submit the current draft query — updates URL and triggers search */
export function submitQuery(): void {
	const q = draftQuery.value.trim();
	if (!q) return;
	activeQuery.value = q;
	pushToUrl();
}

/** Clear the search state */
export function clearSearch(): void {
	draftQuery.value = "";
	activeQuery.value = "";
	cancelRequest();
	loading.value = false;
	pushToUrl();
}

/** Push current state to URL (on submit only, not per-keystroke) */
function pushToUrl(): void {
	const params = new URLSearchParams();
	if (activeQuery.value) params.set("q", activeQuery.value);
	if (mode.value !== "trace") params.set("mode", mode.value);
	if (collection.value) params.set("collection", collection.value);

	const search = params.toString();
	const url = search ? `?${search}` : window.location.pathname;
	window.history.replaceState(null, "", url);
}

/** Sync URL changes on mode/collection change */
effect(() => {
	// Read signals to subscribe
	mode.value;
	collection.value;
	pushToUrl();
});

/** Handle browser back/forward */
window.addEventListener("popstate", () => {
	const q = getParam("q");
	const m = getParam("mode");
	const c = getParam("collection");

	draftQuery.value = q;
	activeQuery.value = q;
	mode.value = m === "search" ? "search" : "trace";
	collection.value = c;
});

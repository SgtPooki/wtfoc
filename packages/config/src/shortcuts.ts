import { URL_SHORTCUTS } from "@wtfoc/common";

export function resolveUrlShortcut(url: string): string {
	return URL_SHORTCUTS[url] ?? url;
}

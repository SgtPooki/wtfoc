import type { SourceAdapter } from "@wtfoc/common";

// biome-ignore lint/suspicious/noExplicitAny: registry must accept adapters with any config type
const adapters = new Map<string, SourceAdapter<any>>();

// biome-ignore lint/suspicious/noExplicitAny: registry must accept adapters with any config type
export function registerAdapter(adapter: SourceAdapter<any>): void {
	adapters.set(adapter.sourceType, adapter);
}

// biome-ignore lint/suspicious/noExplicitAny: callers use parseConfig to get the correct type
export function getAdapter(sourceType: string): SourceAdapter<any> | undefined {
	return adapters.get(sourceType);
}

export function getAvailableSourceTypes(): string[] {
	return [...adapters.keys()];
}

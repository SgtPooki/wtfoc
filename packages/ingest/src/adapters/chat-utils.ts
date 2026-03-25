export const GROUPING_WINDOW_MS = 5 * 60 * 1000;

export interface ChatGroupingAccessors<T> {
	authorId: (msg: T) => string;
	timestampMs: (msg: T) => number;
	text: (msg: T) => string;
}

export interface ChatMessageGroup<T> {
	authorId: string;
	messages: T[];
}

export function groupChatMessages<T>(
	messages: T[],
	accessors: ChatGroupingAccessors<T>,
	sinceMs?: number,
): ChatMessageGroup<T>[] {
	const groups: ChatMessageGroup<T>[] = [];

	for (const msg of messages) {
		if (sinceMs !== undefined && accessors.timestampMs(msg) < sinceMs) continue;
		if (!accessors.text(msg).trim()) continue;

		const authorId = accessors.authorId(msg);
		const lastGroup = groups[groups.length - 1];
		if (lastGroup && lastGroup.authorId === authorId) {
			const lastMsg = lastGroup.messages[lastGroup.messages.length - 1];
			if (!lastMsg) continue;
			const gap = accessors.timestampMs(msg) - accessors.timestampMs(lastMsg);
			if (gap <= GROUPING_WINDOW_MS) {
				lastGroup.messages.push(msg);
				continue;
			}
		}

		groups.push({ authorId, messages: [msg] });
	}

	return groups;
}

import type { ThreadItemType, ThreadState } from "./type-defs";

const THREAD_TABLE_NAMES = ["new-threads", "quick-save", "trash"] as const;

export type ThreadTableName = (typeof THREAD_TABLE_NAMES)[number];

const THREAD_STATES = ["inbox", "saved", "trash"] as const satisfies readonly ThreadState[];

export const isThreadState = (value: unknown): value is ThreadState =>
	typeof value === "string" && THREAD_STATES.includes(value as ThreadState);

export const legacyTableToThreadState = (table: ThreadTableName): ThreadState => {
	switch (table) {
		case "new-threads":
			return "inbox";
		case "quick-save":
			return "saved";
		case "trash":
			return "trash";
	}
};

export interface ThreadListFilterParam {
	key: "filterType";
	value: string;
}

export interface ThreadPage {
	items: ThreadItemType[];
	nextCursor: string | null;
}

export const threadListQueryKey = (state: ThreadState, filterKey = "") =>
	["threads", "list", state, filterKey] as const;

export const threadStatsQueryKey = (state: ThreadState, filterType: string | null = null) =>
	["threads", "stats", state, filterType] as const;

export const normalizeThreadId = (value: string | number) => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}

	const trimmedValue = String(value).trim();

	if (/^[+-]?\d+$/.test(trimmedValue)) {
		try {
			return BigInt(trimmedValue).toString();
		} catch {
			return trimmedValue;
		}
	}

	return trimmedValue;
};

export const flattenThreadPages = (pages: ThreadPage[] | undefined) => {
	const seenIds = new Set<string>();
	const items: ThreadItemType[] = [];

	for (const page of pages ?? []) {
		for (const item of page.items) {
			const id = normalizeThreadId(item.id);
			if (seenIds.has(id)) {
				continue;
			}

			seenIds.add(id);
			items.push(item);
		}
	}

	return items;
};

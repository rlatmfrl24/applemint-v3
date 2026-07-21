import type { ThreadItemType } from "./type-defs";

const THREAD_TABLE_NAMES = ["new-threads", "quick-save", "trash"] as const;

export type ThreadTableName = (typeof THREAD_TABLE_NAMES)[number];

export interface ThreadListFilterParam {
	key: "filterType" | "issuelinkCategory";
	value: string;
}

export interface ThreadPage {
	items: ThreadItemType[];
	nextCursor: string | null;
}

export const threadListQueryKey = (table: ThreadTableName, filterKey = "") =>
	["threads", table, filterKey] as const;

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

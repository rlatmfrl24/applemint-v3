import type { ThreadPage } from "@/contracts/thread.schema";
import type { ThreadItemType, ThreadState } from "./type-defs";

export interface ThreadListFilterParam {
	key: "filterType";
	value: string;
}

export type { ThreadPage } from "@/contracts/thread.schema";

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

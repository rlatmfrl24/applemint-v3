import type { ThreadItem, ThreadState } from "@/contracts/thread.schema";

export interface ThreadPageCursor {
	stateChangedAt: string;
	id: string;
}

export interface ThreadStore {
	list(
		state: ThreadState,
		input: {
			limit: number;
			cursor: ThreadPageCursor | null;
			filterType: string | null;
			filterSite: string | null;
		}
	): Promise<ThreadItem[]>;
	stats(
		state: ThreadState,
		filterType: string | null
	): Promise<{
		rows: Array<{ key: string; count: number; total_count: number }>;
		sites: Array<{ site_key: string; count: number }>;
	}>;
	transition(input: {
		id: string;
		expectedState: ThreadState;
		destinationState: ThreadState;
	}): Promise<ThreadItem>;
	bulkTrashInbox(): Promise<number>;
}

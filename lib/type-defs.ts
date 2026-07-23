export interface CrawlItemType {
	url: string;
	title: string | null;
	description: string | null;
	host: string | null;
	tag?: string[] | null;
}

export type ThreadState = "inbox" | "saved" | "trash";

export interface ThreadItemType {
	id: string | number;
	type: string;
	url: string;
	title: string | null;
	description: string | null;
	host: string | null;
	tag?: string[] | null;
	state: ThreadState;
	created_at: string;
	captured_at: string;
	state_changed_at: string;
}

interface ThreadStatsItem {
	key: string;
	label: string;
	count: number;
}

export interface ThreadStats {
	counts: ThreadStatsItem[];
	totalCount: number;
}

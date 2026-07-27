import type {
	ThreadState as ContractThreadState,
	ThreadStats as ContractThreadStats,
	ThreadItem,
} from "@/contracts/thread.schema";

export interface CrawlItemType {
	url: string;
	title: string | null;
	description: string | null;
	host: string | null;
	tag?: string[] | null;
}

export type ThreadState = ContractThreadState;
export type ThreadItemType = ThreadItem;
export type ThreadStats = ContractThreadStats;

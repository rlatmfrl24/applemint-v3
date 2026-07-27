export interface CrawlItemType {
	url: string;
	title: string | null;
	description: string | null;
	host: string | null;
	tag?: string[] | null;
}

export type ThreadState = "inbox" | "saved" | "trash";

type ThreadMediaProvider = "youtube" | "imgur";
type ThreadMediaKind = "video" | "short" | "live" | "image" | "album" | "gallery" | "unsupported";
type ThreadMediaStatus = "pending" | "ready" | "unavailable" | "unsupported" | "failed";

interface ThreadMediaMetadata {
	provider: ThreadMediaProvider;
	external_id: string | null;
	media_kind: ThreadMediaKind | null;
	status: ThreadMediaStatus;
	title: string | null;
	channel_title: string | null;
	thumbnail_url: string | null;
	duration_seconds: number | null;
	live_status: "none" | "live" | "upcoming" | null;
	media_count: number | null;
	preview_urls: string[];
	last_error_code: string | null;
	fetched_at: string | null;
	updated_at: string;
}

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
	media_metadata: ThreadMediaMetadata | null;
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

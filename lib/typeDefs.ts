export interface CrawlItemType {
	url: string;
	title: string | null;
	description: string | null;
	host: string | null;
	tag?: string[] | null;
}

export interface ThreadItemType {
	id: string | number;
	type: string;
	url: string;
	title: string | null;
	description: string | null;
	host: string | null;
	tag?: string[] | null;
	created_at?: string | null;
}

export interface MediaItemType extends ThreadItemType {
	sub_url: string[] | null;
}

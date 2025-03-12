export interface CrawlItemType {
    url: string;
    title: string;
    description: string;
    host: string;
    tag?: string[];
}

export interface ThreadItemType {
    id: string;
    type: string;
    url: string;
    title: string;
    description: string;
    host: string;
    tag?: string[];
}

export interface MediaItemType extends ThreadItemType {
    sub_url: string[] | null;
}

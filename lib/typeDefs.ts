export interface CrawlItemType {
    url: string;
    title: string;
    description: string;
    host: string;
}

export interface ThreadItemType {
    id: string;
    type: string;
    url: string;
    title: string;
    description: string;
    host: string;
}

export interface MediaItemType extends ThreadItemType {
    media: string[] | null;
}

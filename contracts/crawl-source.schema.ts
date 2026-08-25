import { z } from "zod";

export const CRAWL_SOURCES = [
	"arcalive",
	"battlepage",
	"dogdrip",
	"insagirl",
	"issuelink",
] as const;

export const crawlSourceSchema = z.enum(CRAWL_SOURCES);

export type CrawlSource = z.infer<typeof crawlSourceSchema>;

import "server-only";

export function getBookmarkConfiguration() {
	return {
		raindrop: Boolean(process.env.RAINDROP_IMPORT_TOKEN?.trim()),
		openrouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
		worker: Boolean(process.env.CRAWL_INTERNAL_SECRET?.trim()),
	};
}

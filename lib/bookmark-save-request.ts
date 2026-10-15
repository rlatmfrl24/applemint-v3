import type { QueryClient } from "@tanstack/react-query";

export function recommendationRequest(
	cache: QueryClient,
	source: { id: string; url: string },
	title: string,
	renew = false
) {
	const key = ["bookmark-save-request", source.id, source.url, title.trim()];
	const existing = cache.getQueryData<string>(key);
	if (existing && !renew) return existing;
	const requestId = crypto.randomUUID();
	cache.setQueryDefaults(key, { gcTime: Number.POSITIVE_INFINITY });
	cache.setQueryData(key, requestId);
	return requestId;
}
export function registerRecommendationOnce<T>(
	cache: QueryClient,
	id: string,
	register: (id: string) => Promise<T>
) {
	return cache.fetchQuery({
		queryKey: ["bookmark-save-registration", id],
		queryFn: () => register(id),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

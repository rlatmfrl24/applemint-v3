import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { vi } from "vitest";
import type { z } from "zod";
import type {
	BookmarkCollection,
	BookmarkItem,
	BookmarkJob,
	bookmarkRecommendationStatusSchema,
} from "@/contracts/bookmark.schema";

export const collectionA: BookmarkCollection = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Research",
	parent_id: null,
	version: 3,
	sort_order: 0,
	source_id: null,
	original: null,
	created_at: "2026-10-01T00:00:00Z",
};
export const collectionB: BookmarkCollection = {
	...collectionA,
	id: "22222222-2222-4222-8222-222222222222",
	name: "Reading",
	version: 7,
	sort_order: 1,
};
export const collections = [collectionA, collectionB];
export function bookmarkItem(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
	return {
		id: "33333333-3333-4333-8333-333333333333",
		url: "https://example.com/article",
		url_key: "https://example.com/article",
		title: "Saved article",
		description: "Article description",
		note: "Remember this",
		tags: ["reference"],
		collection_id: collectionA.id,
		previous_collection_path: null,
		state: "library",
		version: 4,
		source_id: null,
		source_thread_id: "123",
		original: null,
		saved_at: "2026-10-01T00:00:00Z",
		created_at: "2026-10-01T00:00:00Z",
		updated_at: "2026-10-01T00:00:00Z",
		opened_at: null,
		open_count: 0,
		review_revision: 2,
		duplicate_count: 0,
		check: null,
		proposals: [],
		last_review: null,
		...overrides,
	};
}
export const source = { id: "123", url: "https://example.com/article", title: "Saved article" };
export const jobId = "44444444-4444-4444-8444-444444444444";
export function recommendationStatus(
	job: Partial<BookmarkJob> = {},
	recommendation: z.infer<typeof bookmarkRecommendationStatusSchema>["recommendation"] = {
		collectionId: collectionB.id,
		collectionVersion: collectionB.version,
		basis: "topic",
		confidence: 0.9,
	}
): z.infer<typeof bookmarkRecommendationStatusSchema> {
	return {
		job: {
			id: jobId,
			kind: "recommend",
			state: "succeeded",
			scope: { threadId: source.id, url: source.url, title: source.title },
			progress: {},
			total: 1,
			completed: 1,
			failed: 0,
			attempts: 1,
			available_at: "2026-10-01T00:00:00Z",
			lease_token: null,
			lease_expires_at: null,
			error: null,
			created_at: "2026-10-01T00:00:00Z",
			updated_at: "2026-10-01T00:00:00Z",
			...job,
		},
		recommendation,
	};
}
export function formTransport() {
	return {
		bookmark: {
			detail: { query: vi.fn().mockResolvedValue({ items: [bookmarkItem()] }) },
			edit: { mutate: vi.fn().mockResolvedValue(bookmarkItem({ version: 5 })) },
			keep: { mutate: vi.fn().mockResolvedValue(bookmarkItem({ version: 5 })) },
			open: { mutate: vi.fn().mockResolvedValue({}) },
			trash: { mutate: vi.fn().mockResolvedValue(bookmarkItem({ version: 5, state: "trash" })) },
			restore: { mutate: vi.fn().mockResolvedValue(bookmarkItem({ version: 5 })) },
			bulk: { mutate: vi.fn().mockResolvedValue({ applied: 2 }) },
			save: { mutate: vi.fn().mockResolvedValue({ existing: false, item: bookmarkItem() }) },
		},
		bookmarkCollection: {
			list: { query: vi.fn().mockResolvedValue(collections) },
			create: { mutate: vi.fn().mockResolvedValue({ ...collectionB, name: "New collection" }) },
			rename: {
				mutate: vi.fn().mockResolvedValue({ ...collectionA, name: "Renamed", version: 4 }),
			},
			reparent: {
				mutate: vi
					.fn()
					.mockResolvedValue({ ...collectionA, parent_id: collectionB.id, version: 4 }),
			},
			remove: {
				mutate: vi.fn().mockResolvedValue({
					deletedId: collectionA.id,
					movedBookmarks: 2,
					reparentedCollections: 1,
				}),
			},
			moveMany: { mutate: vi.fn().mockResolvedValue({ applied: 1 }) },
		},
		bookmarkProposal: { approve: { mutate: vi.fn().mockResolvedValue({ applied: 1 }) } },
		bookmarkImport: { configuration: { query: vi.fn().mockResolvedValue({ openrouter: true }) } },
		bookmarkAI: {
			recommend: { mutate: vi.fn().mockResolvedValue({ id: jobId }) },
			recommendation: { query: vi.fn().mockResolvedValue(recommendationStatus()) },
		},
	};
}
export function queryHarness() {
	const cache = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false },
		},
	});
	function wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
	}
	return { cache, wrapper };
}
export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
export function installBookmarkDom() {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: query === "(min-width:1280px)" || query === "(min-width:768px)",
		media: query,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	}));
	Element.prototype.scrollIntoView = vi.fn();
}

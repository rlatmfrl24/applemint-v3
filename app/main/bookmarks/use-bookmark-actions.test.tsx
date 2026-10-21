// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookmarkCollection, BookmarkItem } from "@/contracts/bookmark.schema";
import { BOOKMARK_CHANGES_KEY, type BookmarkChange } from "@/lib/bookmark-optimistic";
import {
	useBookmarkChange,
	useBookmarkDisplayChanges,
	useCollectionChange,
	useCollectionDisplayChanges,
} from "./use-bookmark-actions";

const { api, notice } = vi.hoisted(() => ({
	api: {
		bookmark: {
			trash: { mutate: vi.fn() },
			restore: { mutate: vi.fn() },
			bulk: { mutate: vi.fn() },
		},
		bookmarkCollection: {
			moveMany: { mutate: vi.fn() },
			rename: { mutate: vi.fn() },
			reparent: { mutate: vi.fn() },
			reorder: { mutate: vi.fn() },
		},
	},
	notice: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/trpc/client", () => ({ useTRPCClient: () => api }));
vi.mock("sonner", () => ({ toast: notice }));
const first = {
	id: "one",
	version: 3,
	title: "First",
	state: "library",
	collection_id: "parent",
} as BookmarkItem;
const second = { ...first, id: "two", title: "Second" };
const collection = {
	id: "parent",
	name: "Original",
	parent_id: null,
	version: 3,
	sort_order: 0,
} as BookmarkCollection;
let cache: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
}
beforeEach(() => {
	vi.clearAllMocks();
	cache = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false },
		},
	});
	for (const group of Object.values(api))
		for (const endpoint of Object.values(group))
			endpoint.mutate.mockReset().mockResolvedValue({ applied: 1 });
});
afterEach(() => {
	cleanup();
	cache.clear();
});

describe("optimistic bookmark commands", () => {
	it("immediately publishes a pending move and waits for acknowledgment before clearing it", async () => {
		let complete: (value: { applied: number }) => void = () => {};
		api.bookmarkCollection.moveMany.mutate.mockImplementation(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				})
		);
		const { result } = renderHook(
			() => ({ action: useBookmarkChange(), changes: useBookmarkDisplayChanges() }),
			{ wrapper }
		);
		act(() =>
			result.current.action.mutate({
				action: "move",
				items: [first, second],
				collectionId: "destination",
			})
		);
		await waitFor(() =>
			expect(result.current.changes).toMatchObject([
				{ action: "move", acknowledged: false, collectionId: "destination" },
			])
		);
		expect(api.bookmarkCollection.moveMany.mutate).toHaveBeenCalledWith({
			items: [
				{ id: "one", version: 3 },
				{ id: "two", version: 3 },
			],
			collectionId: "destination",
		});
		await act(async () => complete({ applied: 2 }));
		await waitFor(() => expect(result.current.action.isSuccess).toBe(true));
		expect(result.current.changes).toEqual([]);
		expect(notice.success).toHaveBeenCalledWith("북마크 2개를 이동했습니다.", expect.anything());
	});
	it("undoes a single trash with the version returned by the server", async () => {
		api.bookmark.trash.mutate.mockResolvedValue({ ...first, state: "trash", version: 4 });
		const { result } = renderHook(useBookmarkChange, { wrapper });
		await act(async () => result.current.mutateAsync({ action: "trash", items: [first] }));
		expect(api.bookmark.trash.mutate).toHaveBeenCalledWith({ id: "one", version: 3 });
		const undo = notice.success.mock.calls[0]?.[1]?.action;
		expect(undo.label).toBe("실행 취소");
		act(() => undo.onClick());
		await waitFor(() =>
			expect(api.bookmark.restore.mutate).toHaveBeenCalledWith({ id: "one", version: 4 })
		);
	});
	it("uses bulk endpoints for multiple items and rejects an empty selection before transport", async () => {
		const { result } = renderHook(useBookmarkChange, { wrapper });
		await act(async () =>
			result.current.mutateAsync({ action: "restore", items: [first, second] })
		);
		expect(api.bookmark.bulk.mutate).toHaveBeenCalledWith({
			action: "restore",
			items: [
				{ id: "one", version: 3 },
				{ id: "two", version: 3 },
			],
		});
		await act(async () => {
			await expect(result.current.mutateAsync({ action: "trash", items: [] })).rejects.toThrow(
				"변경할 항목이 없습니다."
			);
		});
		expect(api.bookmark.trash.mutate).not.toHaveBeenCalled();
	});
	it("rejects overlapping mutations without removing another pending item's change", async () => {
		const existing: BookmarkChange = {
			id: "existing",
			action: "trash",
			items: [first],
			acknowledged: false,
		};
		cache.setQueryData(BOOKMARK_CHANGES_KEY, [existing]);
		const { result } = renderHook(useBookmarkChange, { wrapper });
		await act(async () => {
			await expect(
				result.current.mutateAsync({ action: "restore", items: [first] })
			).rejects.toThrow("이 항목의 이전 변경을 확인하고 있습니다.");
		});
		expect(cache.getQueryData(BOOKMARK_CHANGES_KEY)).toEqual([existing]);
		expect(api.bookmark.restore.mutate).not.toHaveBeenCalled();
	});
	it("rolls back only a rejected command and reports a failed subsequent refresh", async () => {
		api.bookmark.trash.mutate.mockRejectedValue(new Error("Version conflict"));
		vi.spyOn(cache, "invalidateQueries").mockRejectedValue(new Error("Offline"));
		const { result } = renderHook(useBookmarkChange, { wrapper });
		await act(async () => {
			await expect(result.current.mutateAsync({ action: "trash", items: [first] })).rejects.toThrow(
				"Version conflict"
			);
		});
		expect(cache.getQueryData(BOOKMARK_CHANGES_KEY)).toEqual([]);
		expect(notice.error).toHaveBeenCalledWith("Version conflict");
		expect(notice.info).toHaveBeenCalledWith(
			"이전 변경은 저장되었습니다. 최신 목록을 다시 확인해주세요."
		);
	});
	it("retains an acknowledged change when refreshed data cannot be fetched", async () => {
		vi.spyOn(cache, "invalidateQueries").mockRejectedValue(new Error("Offline"));
		const { result } = renderHook(useBookmarkChange, { wrapper });
		await act(async () => result.current.mutateAsync({ action: "move", items: [first] }));
		expect(api.bookmarkCollection.moveMany.mutate).toHaveBeenCalledWith({
			items: [{ id: "one", version: 3 }],
			collectionId: null,
		});
		expect(cache.getQueryData(BOOKMARK_CHANGES_KEY)).toMatchObject([{ acknowledged: true }]);
		expect(notice.info).toHaveBeenCalledWith(
			"변경은 저장되었습니다. 최신 목록을 다시 확인해주세요."
		);
	});
});

describe("optimistic collection commands", () => {
	it.each(["rename", "reparent"] as const)(
		"projects a pending %s then replaces it with the server's authoritative version",
		async (kind) => {
			cache.setQueryData(["bookmarks", "collections"], [collection]);
			const response = { ...collection, name: "Saved", version: 4 };
			let complete: (value: BookmarkCollection) => void = () => {};
			api.bookmarkCollection[kind].mutate.mockImplementation(
				() =>
					new Promise((resolve) => {
						complete = resolve;
					})
			);
			const { result } = renderHook(
				() => ({ action: useCollectionChange(), changes: useCollectionDisplayChanges() }),
				{ wrapper }
			);
			act(() =>
				result.current.action.mutate({
					kind,
					id: "parent",
					version: 3,
					name: "Draft",
					parentId: null,
				})
			);
			await waitFor(() =>
				expect(result.current.changes).toMatchObject([{ kind, id: "parent", version: 3 }])
			);
			await act(async () => complete(response));
			await waitFor(() => expect(result.current.action.isSuccess).toBe(true));
			expect(cache.getQueryData(["bookmarks", "collections"])).toEqual([response]);
			expect(result.current.changes).toEqual([]);
		}
	);
	it("requires the destination version before sending a reorder", async () => {
		const { result } = renderHook(useCollectionChange, { wrapper });
		await act(async () => {
			await expect(
				result.current.mutateAsync({
					kind: "reorder",
					id: "parent",
					version: 3,
					targetId: "next",
					position: "before",
				})
			).rejects.toThrow("대상 컬렉션 버전이 없습니다.");
		});
		expect(api.bookmarkCollection.reorder.mutate).not.toHaveBeenCalled();
	});
	it("submits both reorder versions and preserves saved state when refresh fails", async () => {
		cache.setQueryData(["bookmarks", "collections"], [collection]);
		api.bookmarkCollection.reorder.mutate.mockResolvedValue({ ...collection, version: 4 });
		vi.spyOn(cache, "invalidateQueries").mockRejectedValue(new Error("Refresh unavailable"));
		const { result } = renderHook(useCollectionChange, { wrapper });
		await act(async () =>
			result.current.mutateAsync({
				kind: "reorder",
				id: "parent",
				version: 3,
				targetId: "next",
				targetVersion: 7,
				position: "after",
			})
		);
		expect(api.bookmarkCollection.reorder.mutate).toHaveBeenCalledWith(
			expect.objectContaining({ version: 3, targetVersion: 7, position: "after" })
		);
		expect(cache.getQueryData(["bookmarks", "collections"])).toMatchObject([{ version: 4 }]);
		expect(notice.info).toHaveBeenCalledWith(
			"변경은 저장되었습니다. 최신 컬렉션을 다시 확인해주세요."
		);
	});
});

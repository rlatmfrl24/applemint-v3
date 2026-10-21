// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookmarkCollection, BookmarkItem } from "@/contracts/bookmark.schema";
import type { BookmarkCollectionDialog } from "./bookmark-collection-dialog";
import type { BookmarkCollectionTree } from "./bookmark-collection-tree";
import type { BookmarkItemDialog } from "./bookmark-item-dialog";
import { BookmarkLibrary } from "./bookmark-library";
import type { BookmarkRow } from "./bookmark-row";

const { api, push, notice } = vi.hoisted(() => {
	const endpoint = () => ({ query: vi.fn(), mutate: vi.fn() });
	return {
		api: {
			bookmark: {
				list: endpoint(),
				bulk: endpoint(),
				trash: endpoint(),
				restore: endpoint(),
			},
			bookmarkImport: { status: endpoint() },
			bookmarkCollection: {
				list: endpoint(),
				moveMany: endpoint(),
				rename: endpoint(),
				reparent: endpoint(),
				reorder: endpoint(),
			},
			bookmarkCheck: { start: endpoint() },
			bookmarkAI: { classify: endpoint(), review: endpoint() },
			bookmarkProposal: { approve: endpoint(), excludeBookmarks: endpoint() },
		},
		push: vi.fn(),
		notice: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
	};
});
vi.mock("@/trpc/client", () => ({ useTRPCClient: () => api }));
vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(window.location.search),
	useRouter: () => ({ push }),
}));
vi.mock("sonner", () => ({ toast: notice }));
// Each child has its own interaction suite. These adapters exercise the manager's
// public child callbacks while keeping routing and asynchronous state real.
vi.mock("./bookmark-row", () => ({
	BookmarkRow: (p: ComponentProps<typeof BookmarkRow>) => (
		<article draggable onDragStart={(event) => p.startDrag(event, p.item)} onDragEnd={p.endDrag}>
			<label>
				<input
					type="checkbox"
					aria-label={`Select ${p.item.title}`}
					checked={p.checked}
					disabled={p.selectionDisabled}
					onChange={p.select}
				/>
				{p.item.title}
			</label>
			<button
				type="button"
				onClick={() => p.detail({ id: p.item.id, mode: "edit", trigger: null })}
			>
				Edit {p.item.title}
			</button>
		</article>
	),
}));
vi.mock("./bookmark-collection-tree", () => ({
	BookmarkCollectionTree: (p: ComponentProps<typeof BookmarkCollectionTree>) => (
		<aside>
			{["all", "", "trash", ...p.collections.map((c) => c.id)].map((id) => (
				<button
					key={id}
					type="button"
					onClick={() => p.select(id)}
					onDragOver={(e) => e.preventDefault()}
					onDrop={() => p.move(id || null)}
				>
					Collection {id || "unfiled"}
				</button>
			))}
			{p.collections.map((c) => (
				<section
					aria-label={c.name}
					key={c.id}
					draggable
					onDragStart={(e) => p.startDrag(e, c)}
					onDragEnd={p.endDrag}
				>
					<button
						type="button"
						onClick={() =>
							p.manage({ mode: "rename", collection: c, parentId: c.parent_id, trigger: null })
						}
					>
						Manage {c.name}
					</button>
					<button type="button" onClick={() => p.reparent(c, null)}>
						Root {c.name}
					</button>
					<button type="button" onClick={() => p.reorder(c, p.collections[0], "before")}>
						Before {c.name}
					</button>
				</section>
			))}
			{p.error && (
				<button type="button" onClick={p.retry}>
					Retry collections
				</button>
			)}
		</aside>
	),
}));
vi.mock("./bookmark-item-dialog", () => ({
	BookmarkItemDialog: (p: ComponentProps<typeof BookmarkItemDialog>) =>
		p.selection && (
			<section aria-label="Item editor">
				<label>
					Draft
					<input onChange={() => p.onDirtyChange(true)} />
				</label>
				<button type="button" onClick={p.close}>
					Close editor
				</button>
				<button type="button" onClick={() => p.changeMode("details")}>
					Read details
				</button>
			</section>
		),
}));
vi.mock("./bookmark-collection-dialog", () => ({
	BookmarkCollectionDialog: (p: ComponentProps<typeof BookmarkCollectionDialog>) =>
		p.selection && (
			<section aria-label="Collection editor">
				<button type="button" onClick={p.close}>
					Close collection editor
				</button>
				<button type="button" onClick={() => p.removed("one")}>
					Removed collection
				</button>
			</section>
		),
}));

const collections: BookmarkCollection[] = [
	{
		id: "one",
		name: "Reading",
		parent_id: null,
		version: 1,
		sort_order: 0,
		source_id: null,
		original: null,
		created_at: "2026-10-01",
	},
	{
		id: "two",
		name: "Research",
		parent_id: "one",
		version: 2,
		sort_order: 1,
		source_id: null,
		original: null,
		created_at: "2026-10-01",
	},
];
function item(id: string): BookmarkItem {
	return {
		id,
		title: id,
		url: `https://example.com/${id}`,
		url_key: id,
		description: "",
		tags: [],
		note: "",
		collection_id: "one",
		previous_collection_path: null,
		state: "library",
		version: 3,
		source_id: null,
		source_thread_id: null,
		original: null,
		saved_at: "2026-10-01",
		created_at: "2026-10-01",
		updated_at: "2026-10-01",
		opened_at: null,
		open_count: 0,
		review_revision: 0,
		duplicate_count: 0,
		check: null,
		proposals: [],
		last_review: null,
	};
}
const items = [item("Alpha"), item("Beta")];
const page = (values = items, total = values.length) => ({ items: values, total, collections });
let cache: QueryClient;
function mount(view: ComponentProps<typeof BookmarkLibrary>["view"] = "library") {
	cache = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={cache}>
			<BookmarkLibrary view={view} />
		</QueryClientProvider>
	);
}
beforeEach(() => {
	vi.clearAllMocks();
	window.history.replaceState(null, "", "/main/bookmarks");
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		}
	);
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			disconnect() {}
		}
	);
	api.bookmark.list.query.mockReset().mockResolvedValue(page());
	api.bookmarkImport.status.query.mockReset().mockResolvedValue([]);
	api.bookmarkCollection.list.query.mockReset().mockResolvedValue(collections);
	for (const group of Object.values(api)) {
		for (const endpoint of Object.values(group))
			endpoint.mutate.mockReset().mockResolvedValue({ applied: 1 });
	}
});
afterEach(() => {
	cleanup();
	cache?.clear();
	vi.unstubAllGlobals();
});

describe("bookmark library navigation and results", () => {
	it("loads pages without duplicate rows and retries a failed next page without losing earlier items", async () => {
		api.bookmark.list.query
			.mockResolvedValueOnce(page([items[0]], 2))
			.mockRejectedValueOnce(new Error("next page unavailable"))
			.mockResolvedValueOnce(page([items[1]], 2));
		mount();
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByRole("button", { name: "더 불러오기" }));
		await screen.findByRole("alert");
		expect(screen.getByLabelText("Select Alpha")).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
		await screen.findByLabelText("Select Beta");
		expect(screen.getAllByRole("article")).toHaveLength(2);
		expect(api.bookmark.list.query.mock.calls.at(-1)?.[0].offset).toBe(1);
	});
	it("commits searches on Enter, clears empty results, and preserves collection filters", async () => {
		window.history.replaceState(null, "", "/main/bookmarks?collection=one");
		mount();
		await screen.findByLabelText("Select Alpha");
		api.bookmark.list.query.mockResolvedValue(page([]));
		const search = screen.getByRole("textbox", { name: "북마크 검색" });
		fireEvent.change(search, { target: { value: "missing" } });
		fireEvent.keyDown(search, { key: "Enter" });
		await screen.findByText("검색 결과가 없습니다.");
		expect(window.location.search).toBe("?collection=one&search=missing");
		fireEvent.click(screen.getByRole("button", { name: "검색 초기화" }));
		await waitFor(() => expect(window.location.search).toBe("?collection=one"));
		expect(api.bookmark.list.query.mock.calls.at(-1)?.[0]).toMatchObject({
			collectionId: "one",
			search: "",
		});
	});
	it("keeps composition input local until composition ends and debounces search", async () => {
		mount();
		await screen.findByLabelText("Select Alpha");
		const search = screen.getByRole("textbox", { name: "북마크 검색" });
		fireEvent.compositionStart(search);
		fireEvent.change(search, { target: { value: "한글" } });
		fireEvent.keyDown(search, { key: "Enter", isComposing: true });
		expect(window.location.search).toBe("");
		fireEvent.compositionEnd(search);
		await waitFor(() => expect(api.bookmark.list.query.mock.calls.at(-1)?.[0].search).toBe("한글"));
		expect(new URLSearchParams(window.location.search).get("search")).toBe("한글");
	});
	it("maps unfiled/trash selections and invalid review filters safely", async () => {
		mount();
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByRole("button", { name: "Collection unfiled" }));
		expect(window.location.search).toBe("?collection=unfiled");
		fireEvent.click(screen.getByRole("button", { name: "Collection trash" }));
		expect(window.location.search).toBe("?state=trash");
	});
	it("shows transport errors and recovers with a refresh", async () => {
		api.bookmark.list.query.mockRejectedValueOnce(new Error("List unavailable"));
		mount();
		await screen.findByText("List unavailable");
		fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
		await screen.findByLabelText("Select Alpha");
	});
	it("loads activity without fetching the library, and retries activity errors", async () => {
		api.bookmarkImport.status.query.mockRejectedValueOnce(new Error("Jobs unavailable"));
		mount("activity");
		await screen.findByText("Jobs unavailable");
		expect(api.bookmark.list.query).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
		await screen.findByText("등록한 작업이 없습니다.");
	});
});

describe("bookmark manager actions", () => {
	it.each(["approve", "excludeBookmarks"] as const)(
		"handles selected review proposals with %s",
		async (operation) => {
			const candidate: BookmarkItem = {
				...items[0],
				proposals: [
					{
						id: "proposal",
						bookmark_id: "Alpha",
						job_id: "job",
						kind: "classify",
						state: "pending",
						expected_version: 3,
						expected_review_revision: 0,
						expected_interest_version: 1,
						target_collection_id: "two",
						new_collection_name: null,
						reason: "Relevant research",
						relevance: null,
						created_at: "2026-10-21",
					},
				],
			};
			api.bookmark.list.query.mockResolvedValue(page([candidate]));
			mount("review");
			await screen.findByLabelText("Select Alpha");
			fireEvent.click(screen.getByLabelText("Select Alpha"));
			fireEvent.click(
				screen.getByRole("button", {
					name: operation === "approve" ? "선택 컬렉션 원안 승인 1개" : "선택 제안 제외",
				})
			);
			await waitFor(() =>
				expect(api.bookmarkProposal[operation].mutate).toHaveBeenCalledWith({
					items: operation === "approve" ? [{ id: "proposal" }] : [{ id: "Alpha", version: 3 }],
				})
			);
			await waitFor(() =>
				expect((screen.getByLabelText("Select Alpha") as HTMLInputElement).checked).toBe(false)
			);
		}
	);
	it("keeps selected review items without modifying the original versions", async () => {
		mount("review");
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByLabelText("Select Alpha"));
		fireEvent.click(screen.getByRole("button", { name: "선택 항목 유지" }));
		await waitFor(() =>
			expect(api.bookmark.bulk.mutate).toHaveBeenCalledWith({
				action: "keep",
				items: [{ id: "Alpha", version: 3 }],
			})
		);
	});
	it("restores selected trash items with their current server version", async () => {
		api.bookmark.list.query.mockResolvedValue(page([{ ...items[0], state: "trash" }]));
		mount("trash");
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByLabelText("Select Alpha"));
		fireEvent.click(screen.getByRole("button", { name: "선택 항목 복원" }));
		await waitFor(() =>
			expect(api.bookmark.restore.mutate).toHaveBeenCalledWith({ id: "Alpha", version: 3 })
		);
	});
	it("returns to all bookmarks when the current collection is removed", async () => {
		window.history.replaceState(null, "", "/main/bookmarks?collection=one");
		mount();
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByRole("button", { name: "Manage Reading" }));
		fireEvent.click(screen.getByRole("button", { name: "Removed collection" }));
		expect(window.location.search).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "Close collection editor" }));
		expect(screen.queryByRole("region", { name: "Collection editor" })).toBeNull();
	});
	it("moves a dragged collection to the root using its optimistic version", async () => {
		api.bookmarkCollection.reparent.mutate.mockResolvedValue({
			...collections[1],
			parent_id: null,
		});
		mount();
		await screen.findByLabelText("Select Alpha");
		const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
		fireEvent.dragStart(screen.getByRole("region", { name: "Research" }), { dataTransfer });
		fireEvent.drop(screen.getByRole("button", { name: "Collection unfiled" }));
		await waitFor(() =>
			expect(api.bookmarkCollection.reparent.mutate).toHaveBeenCalledWith(
				expect.objectContaining({ id: "two", version: 2, parentId: null })
			)
		);
		expect(dataTransfer.setData).toHaveBeenCalledWith("application/x-applemint-collection", "two");
	});
	it("submits selected IDs and server versions for bulk trash, then clears selection", async () => {
		mount();
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByLabelText("불러온 항목 선택"));
		fireEvent.click(screen.getByRole("button", { name: "선택 항목 휴지통 이동" }));
		await waitFor(() =>
			expect(api.bookmark.bulk.mutate).toHaveBeenCalledWith({
				action: "trash",
				items: items.map(({ id, version }) => ({ id, version })),
			})
		);
		await waitFor(() =>
			expect((screen.getByLabelText("불러온 항목 선택") as HTMLInputElement).checked).toBe(false)
		);
	});
	it.each(["selected", "collection", "all"])(
		"starts link checking within the %s scope",
		async (scope) => {
			window.history.replaceState(null, "", "/main/bookmarks?collection=one");
			mount();
			await screen.findByLabelText("Select Alpha");
			fireEvent.click(screen.getByLabelText("Select Alpha"));
			fireEvent.change(screen.getByRole("combobox", { name: "작업 범위" }), {
				target: { value: scope },
			});
			fireEvent.click(screen.getByRole("button", { name: "링크 검사" }));
			const expected =
				scope === "selected"
					? { scope, ids: ["Alpha"] }
					: scope === "collection"
						? { scope, collectionId: "one" }
						: { scope };
			await waitFor(() => expect(api.bookmarkCheck.start.mutate).toHaveBeenCalledWith(expected));
		}
	);
	it("reports job failures without silently clearing the user's selection", async () => {
		api.bookmarkCheck.start.mutate.mockRejectedValue(new Error("Job refused"));
		mount();
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByLabelText("Select Alpha"));
		fireEvent.click(screen.getByRole("button", { name: "링크 검사" }));
		await waitFor(() => expect(notice.error).toHaveBeenCalledWith("Job refused"));
		expect((screen.getByLabelText("Select Alpha") as HTMLInputElement).checked).toBe(true);
	});
	it("reorders and reparents collections with both optimistic versions", async () => {
		mount();
		await screen.findByLabelText("Select Alpha");
		api.bookmarkCollection.reorder.mutate.mockResolvedValue(collections[1]);
		fireEvent.click(screen.getByRole("button", { name: "Before Research" }));
		await waitFor(() =>
			expect(api.bookmarkCollection.reorder.mutate).toHaveBeenCalledWith(
				expect.objectContaining({
					id: "two",
					version: 2,
					targetId: "one",
					targetVersion: 1,
					position: "before",
				})
			)
		);
		await waitFor(() => expect(screen.queryByText("컬렉션 이동 중…")).toBeNull());
		api.bookmarkCollection.reparent.mutate.mockResolvedValue({
			...collections[1],
			parent_id: null,
		});
		fireEvent.click(screen.getByRole("button", { name: "Root Research" }));
		await waitFor(() =>
			expect(api.bookmarkCollection.reparent.mutate).toHaveBeenCalledWith(
				expect.objectContaining({ id: "two", version: 2, parentId: null })
			)
		);
	});
	it("moves dragged bookmarks using the selected group and avoids a no-op move", async () => {
		mount();
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByLabelText("불러온 항목 선택"));
		const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
		fireEvent.dragStart(screen.getAllByRole("article")[0], {
			dataTransfer,
		});
		fireEvent.drop(screen.getByRole("button", { name: "Collection two" }));
		await waitFor(() =>
			expect(api.bookmarkCollection.moveMany.mutate).toHaveBeenCalledWith({
				collectionId: "two",
				items: items.map(({ id, version }) => ({ id, version })),
			})
		);
		expect(dataTransfer.setData).toHaveBeenCalledWith("application/x-applemint-bookmark", "Alpha");
	});
	it("protects unsaved details when closing and discards only after confirmation", async () => {
		mount();
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
		fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Unsaved title" } });
		fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
		await screen.findByRole("alertdialog");
		expect(screen.getByRole("region", { name: "Item editor", hidden: true })).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
		expect(screen.getByLabelText("Draft")).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
		fireEvent.click(screen.getByRole("button", { name: "변경 내용 버리기" }));
		await waitFor(() => expect(screen.queryByLabelText("Draft")).toBeNull());
	});
	it("guards internal navigation while editing, then resumes the chosen route", async () => {
		mount();
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
		fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Dirty" } });
		fireEvent.click(screen.getByRole("link", { name: "검토" }));
		await screen.findByRole("alertdialog");
		fireEvent.click(screen.getByRole("button", { name: "변경 내용 버리기" }));
		expect(push).toHaveBeenCalledWith("/main/bookmarks/review");
	});
});

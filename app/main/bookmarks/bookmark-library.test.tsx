// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookmarkCollection, BookmarkItem, BookmarkJob } from "@/contracts/bookmark.schema";
import { bookmarkHealthEvidenceSchema } from "@/contracts/bookmark-health.schema";
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
				keep: endpoint(),
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
			<section aria-label="Item editor" data-item-id={p.selection.id}>
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
const page = (values = items, total = values.length) => ({
	items: values,
	total,
	collections,
	jobs: [] as BookmarkJob[],
});
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

it("notices evidence without aborting or reloading the visible list", async () => {
	mount("review");
	await screen.findByLabelText("Select Alpha");
	let resolve!: (value: ReturnType<typeof page>) => void;
	api.bookmark.list.query.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			})
	);
	const pending = cache.refetchQueries({ queryKey: ["bookmarks", "list"] });
	await waitFor(() => expect(api.bookmark.list.query).toHaveBeenCalledTimes(2));
	const signal = api.bookmark.list.query.mock.calls.at(-1)?.[1].signal as AbortSignal;
	await act(async () => {
		cache.setQueryData(
			["bookmarks", "jobs"],
			[
				{
					id: "check",
					kind: "check",
					state: "retry",
					updated_at: "2",
					progress: { healthResultRevision: 1 },
				},
			]
		);
		await new Promise((done) => setTimeout(done, 0));
	});
	expect(signal.aborted).toBe(false);
	resolve(page());
	await pending;
	await screen.findByRole("button", { name: "새 결과 보기" });
	expect(api.bookmark.list.query).toHaveBeenCalledTimes(2);
	fireEvent.click(screen.getByRole("button", { name: "새 결과 보기" }));
	await waitFor(() => expect(api.bookmark.list.query).toHaveBeenCalledTimes(3));
});

it("refreshes the active detail when a new health result is published", async () => {
	mount("review");
	await screen.findByLabelText("Select Alpha");
	const readDetail = vi.fn().mockResolvedValue({ evidenceRevision: 1 });
	const observer = new QueryObserver(cache, {
		queryKey: ["bookmarks", "detail", "Alpha"],
		queryFn: readDetail,
	});
	const unsubscribe = observer.subscribe(() => {});
	try {
		await waitFor(() => expect(readDetail).toHaveBeenCalledOnce());
		await act(async () => {
			cache.setQueryData(
				["bookmarks", "jobs"],
				[
					{
						id: "check",
						kind: "check",
						state: "retry",
						updated_at: "2",
						progress: { healthResultRevision: 1 },
					},
				]
			);
		});
		await waitFor(() => expect(readDetail).toHaveBeenCalledTimes(2));
	} finally {
		unsubscribe();
	}
});

it("shows collections created by an import after its result event", async () => {
	mount();
	await screen.findByLabelText("Select Alpha");
	api.bookmarkCollection.list.query.mockResolvedValue([
		...collections,
		{ ...collections[0], id: "imported", name: "Imported" },
	]);
	await act(async () => {
		cache.setQueryData(
			["bookmarks", "jobs"],
			[{ id: "import", kind: "import", state: "succeeded", updated_at: "2" }]
		);
	});
	await screen.findByRole("button", { name: "Collection imported" });
});

it("compares the first job response with the initial list snapshot before discarding a result event", async () => {
	let finishList!: (value: ReturnType<typeof page>) => void;
	let finishJobs!: (value: object[]) => void;
	api.bookmark.list.query.mockImplementationOnce(
		() =>
			new Promise((done) => {
				finishList = done;
			})
	);
	api.bookmarkImport.status.query.mockImplementationOnce(
		() =>
			new Promise((done) => {
				finishJobs = done;
			})
	);
	mount("review");
	await waitFor(() => expect(api.bookmarkImport.status.query).toHaveBeenCalledOnce());
	await act(async () => {
		finishJobs([
			{
				id: "check",
				kind: "check",
				state: "retry",
				updated_at: "2",
				progress: { healthResultRevision: 1 },
			},
		]);
		await new Promise((done) => setTimeout(done, 0));
	});
	await act(async () => {
		finishList(page());
	});
	await screen.findByLabelText("Select Alpha");
	await screen.findByRole("button", { name: "새 결과 보기" });
	expect(api.bookmark.list.query).toHaveBeenCalledOnce();
});

describe("bookmark library navigation and results", () => {
	it("closes the linked panel when navigation removes its bookmark parameter", async () => {
		window.history.replaceState(null, "", "/main/bookmarks?bookmark=linked-id");
		const { rerender } = mount();
		await screen.findByRole("region", { name: "Item editor" });
		window.history.replaceState(null, "", "/main/bookmarks");
		rerender(
			<QueryClientProvider client={cache}>
				<BookmarkLibrary />
			</QueryClientProvider>
		);
		await waitFor(() => expect(screen.queryByRole("region", { name: "Item editor" })).toBeNull());
	});
	it("confirms linked navigation before replacing a dirty item draft", async () => {
		const { rerender } = mount();
		await screen.findByLabelText("Select Alpha");
		fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
		fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Unsaved" } });
		window.history.replaceState(null, "", "/main/bookmarks?bookmark=linked-id");
		rerender(
			<QueryClientProvider client={cache}>
				<BookmarkLibrary />
			</QueryClientProvider>
		);
		await screen.findByText("편집 내용을 버릴까요?");
		expect(document.querySelector('[data-item-id="Alpha"]')).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
		expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe("Unsaved");
	});
	it("opens a linked bookmark through its existing detail panel and clears the link when closed", async () => {
		window.history.replaceState(null, "", "/main/bookmarks?state=trash&bookmark=linked-id");
		mount();
		await screen.findByRole("region", { name: "Item editor" });
		fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
		await waitFor(() => expect(screen.queryByRole("region", { name: "Item editor" })).toBeNull());
		expect(new URLSearchParams(window.location.search).get("bookmark")).toBeNull();
		expect(new URLSearchParams(window.location.search).get("state")).toBe("trash");
	});
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
			expect(api.bookmark.keep.mutate).toHaveBeenCalledWith({ id: "Alpha", version: 3 })
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
it.each(["content", "media", "uncheckable"])(
	"routes the %s health filter with server totals",
	async (type) => {
		window.history.replaceState(null, "", `/main/bookmarks/review?type=${type}`);
		api.bookmark.list.query.mockResolvedValue(page(items, 37));
		mount("review");
		await screen.findByText("Alpha");
		expect(api.bookmark.list.query.mock.calls[0]?.[0]).toMatchObject(
			type === "uncheckable"
				? { reviewGroup: "attention", reviewType: "all" }
				: { reviewGroup: "problems", reviewType: type }
		);
		expect(screen.getAllByText(/37/).length).toBeGreaterThan(0);
	}
);
it("bulk keep includes each displayed check revision", async () => {
	const current = item("Health");
	current.check = {
		id: "99999999-9999-4999-8999-999999999999",
		bookmark_id: current.id,
		job_id: "66666666-6666-4666-8666-666666666666",
		bookmark_version: current.version,
		status: "healthy",
		reason: "HTTP 200",
		final_url: current.url,
		http_status: 200,
		checked_at: "2026-10-22T00:00:00Z",
		checked_url: current.url,
		evidence: bookmarkHealthEvidenceSchema.parse({ observedAt: "2026-10-22T00:00:00Z" }),
		evidence_revision: 4,
		reviewed_at: null,
	};
	api.bookmark.list.query.mockResolvedValue(page([current, items[0]]));
	mount("review");
	fireEvent.click(await screen.findByRole("checkbox", { name: "Select Health" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
	fireEvent.click(screen.getByRole("button", { name: "선택 항목 유지" }));
	await waitFor(() =>
		expect(api.bookmark.bulk.mutate).toHaveBeenCalledWith({
			action: "keep",
			items: [
				{
					id: current.id,
					version: current.version,
					evidenceId: current.check?.id,
					evidenceRevision: 4,
				},
				{ id: "Alpha", version: 3 },
			],
		})
	);
});
it("manual start exposes the all-reused result with a jobs entry point", async () => {
	api.bookmarkCheck.start.mutate.mockResolvedValue({
		job: null,
		requestedCount: 1,
		queuedCount: 0,
		reusedCount: 1,
		activeJobIds: ["job"],
	});
	mount();
	fireEvent.click(await screen.findByRole("checkbox", { name: "Select Alpha" }));
	fireEvent.click(screen.getByRole("button", { name: "링크 검사" }));
	await screen.findByText(/새 검사 0개 · 진행 중 1개 재사용/);
	expect(screen.getByRole("link", { name: "진행 작업 보기" }).getAttribute("href")).toBe(
		"/main/bookmarks/activity"
	);
});

it("defaults to confirmed problems and strips hidden review searches", async () => {
	window.history.replaceState(null, "", "/main/bookmarks/review?search=hidden");
	mount("review");
	await screen.findByLabelText("Select Alpha");
	expect(api.bookmark.list.query.mock.calls[0]?.[0]).toMatchObject({
		reviewGroup: "problems",
		search: "",
	});
	expect(window.location.search).not.toContain("search=");
	expect(screen.queryByRole("textbox", { name: "북마크 검색" })).toBeNull();
	expect(screen.queryByText("저장 · 검토 · 정리")).toBeNull();
	expect(screen.queryByRole("link", { name: "작업 기록" })).toBeNull();
	expect((screen.getByRole("combobox", { name: "검토 범위" }) as HTMLSelectElement).value).toBe(
		"problems"
	);
});

it.each([
	["unused", "organize"],
	["classify", "classify"],
	["uncheckable", "attention"],
])("maps legacy %s links to %s", async (type, group) => {
	window.history.replaceState(null, "", `/main/bookmarks/review?type=${type}`);
	mount("review");
	await screen.findByLabelText("Select Alpha");
	expect(api.bookmark.list.query.mock.calls[0]?.[0]).toMatchObject({ reviewGroup: group });
	expect(screen.queryByRole("button", { name: "죽은 링크" })).toBeNull();
});

it("preserves selection through repeated publications and failed explicit refresh", async () => {
	mount("review");
	const checkbox = await screen.findByLabelText("Select Alpha");
	fireEvent.click(checkbox);
	for (const revision of [1, 2, 3]) {
		await act(async () => {
			cache.setQueryData(
				["bookmarks", "jobs"],
				[
					{
						id: "check",
						kind: "check",
						state: "retry",
						updated_at: `${revision}`,
						progress: { healthResultRevision: revision },
					},
				]
			);
		});
	}
	await screen.findByRole("button", { name: "새 결과 보기" });
	expect(api.bookmark.list.query).toHaveBeenCalledOnce();
	expect((checkbox as HTMLInputElement).checked).toBe(true);
	expect(screen.queryByText("목록 갱신 중…")).toBeNull();
	api.bookmark.list.query.mockRejectedValueOnce(new Error("offline"));
	fireEvent.click(screen.getByRole("button", { name: "새 결과 보기" }));
	await waitFor(() => expect(notice.error).toHaveBeenCalled());
	expect((screen.getByLabelText("Select Alpha") as HTMLInputElement).checked).toBe(true);
	expect(screen.getByRole("button", { name: "새 결과 보기" })).toBeDefined();
	api.bookmark.list.query.mockResolvedValueOnce(page([item("New")]));
	fireEvent.click(screen.getByRole("button", { name: "새 결과 보기" }));
	await screen.findByLabelText("Select New");
	expect((screen.getByLabelText("Select New") as HTMLInputElement).checked).toBe(false);
	expect(api.bookmark.list.query.mock.calls.at(-1)?.[0].offset).toBe(0);
});

it("keeps a newer publication notice when it arrives during explicit refresh", async () => {
	mount("review");
	await screen.findByLabelText("Select Alpha");
	const publication = (revision: number): BookmarkJob[] => [
		{
			id: "check",
			kind: "check",
			state: "retry",
			updated_at: `${revision}`,
			progress: { healthResultRevision: revision },
			scope: {},
			total: 1,
			completed: 0,
			failed: 0,
			attempts: 0,
			available_at: "2026-10-26T00:00:00Z",
			lease_token: null,
			lease_expires_at: null,
			error: null,
			created_at: "2026-10-26T00:00:00Z",
		},
	];
	await act(async () => {
		cache.setQueryData(["bookmarks", "jobs"], publication(1));
	});
	const result = Promise.withResolvers<ReturnType<typeof page>>();
	api.bookmark.list.query.mockReturnValueOnce(result.promise);
	fireEvent.click(await screen.findByRole("button", { name: "새 결과 보기" }));
	await waitFor(() => expect(api.bookmark.list.query).toHaveBeenCalledTimes(2));
	await act(async () => {
		cache.setQueryData(["bookmarks", "jobs"], publication(2));
		result.resolve({ ...page(), jobs: publication(1) });
	});
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "새 결과 보기" }).hasAttribute("disabled")).toBe(
			false
		)
	);
	expect(api.bookmark.list.query).toHaveBeenCalledTimes(2);
});

it("does not reset the new group's selection when an older refresh finishes", async () => {
	mount("review");
	await screen.findByLabelText("Select Alpha");
	const previous = Promise.withResolvers<ReturnType<typeof page>>();
	api.bookmark.list.query.mockReturnValueOnce(previous.promise);
	fireEvent.click(screen.getByRole("button", { name: "목록 새로고침" }));
	await waitFor(() => expect(api.bookmark.list.query).toHaveBeenCalledTimes(2));
	api.bookmark.list.query.mockResolvedValueOnce(page([item("Attention")]));
	fireEvent.change(screen.getByRole("combobox", { name: "검토 범위" }), {
		target: { value: "attention" },
	});
	const checkbox = await screen.findByLabelText("Select Attention");
	fireEvent.click(checkbox);
	await act(async () => {
		previous.resolve(page([item("Old refresh")]));
	});
	expect((screen.getByLabelText("Select Attention") as HTMLInputElement).checked).toBe(true);
	expect(screen.queryByLabelText("Select Old refresh")).toBeNull();
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	bookmarkItem,
	collectionA,
	collectionB,
	deferred,
	formTransport,
	installBookmarkDom,
	jobId,
	queryHarness,
	source,
} from "@/test-support/bookmark-form-fixtures";
import BookmarkSaveRoot from "./bookmark-save-form";

const backend = vi.hoisted(() => ({
	client: {} as ReturnType<typeof formTransport>,
	success: vi.fn(),
	error: vi.fn(),
	push: vi.fn(),
}));
vi.mock("@/trpc/client", () => ({ useTRPCClient: () => backend.client }));
vi.mock("sonner", () => ({ toast: backend }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: backend.push }) }));

beforeEach(() => {
	backend.client = formTransport();
	installBookmarkDom();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
function mount(recommendationId?: string) {
	const harness = queryHarness();
	const props = { source, recommendationId, close: vi.fn(), returnFocus: vi.fn() };
	return { ...render(<BookmarkSaveRoot {...props} />, harness), ...harness, props };
}

describe("bookmark save form", () => {
	it.each([undefined, jobId])(
		"waits for lookup before starting recommendation %s",
		async (recommendationId) => {
			const pending = deferred<null>();
			backend.client.bookmark.lookup.query.mockReturnValue(pending.promise);
			mount(recommendationId);
			await screen.findByText("저장 여부를 확인하고 있어요");
			expect(backend.client.bookmarkAI.recommend.mutate).not.toHaveBeenCalled();
			expect(backend.client.bookmarkAI.recommendation.query).not.toHaveBeenCalled();
			expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
			await act(async () => pending.resolve(null));
			await screen.findByText("AI 추천");
			expect(backend.client.bookmark.lookup.query).toHaveBeenCalledWith({
				url: source.url,
				threadId: source.id,
			});
		}
	);
	it.each(["library", "trash"] as const)(
		"routes an existing %s bookmark without AI or saving",
		async (state) => {
			backend.client.bookmark.lookup.query.mockResolvedValue(
				bookmarkItem({ state, title: "Existing title" })
			);
			const { props } = mount(jobId);
			await screen.findByText("Existing title");
			expect(screen.getByText(source.url)).toBeTruthy();
			expect(backend.client.bookmarkAI.recommend.mutate).not.toHaveBeenCalled();
			expect(backend.client.bookmarkAI.recommendation.query).not.toHaveBeenCalled();
			expect(backend.client.bookmark.save.mutate).not.toHaveBeenCalled();
			fireEvent.click(
				screen.getByRole("button", {
					name: state === "trash" ? "휴지통에서 보기" : "기존 북마크 보기",
				})
			);
			expect(backend.push).toHaveBeenCalledWith(
				`/main/bookmarks?state=${state}&bookmark=${bookmarkItem().id}`
			);
			await waitFor(() => expect(props.close).toHaveBeenCalled());
		}
	);
	it("keeps lookup errors closed to recommendation and save until retry succeeds", async () => {
		backend.client.bookmark.lookup.query.mockRejectedValueOnce(new Error("Lookup offline"));
		mount();
		expect((await screen.findByRole("alert")).textContent).toContain("Lookup offline");
		expect(backend.client.bookmarkAI.recommend.mutate).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
		await screen.findByText("AI 추천");
		expect(backend.client.bookmark.lookup.query).toHaveBeenCalledTimes(2);
	});
	it("waits for fresh lookup on reopen even when the cache says the URL is new", async () => {
		const { props, wrapper, unmount } = mount(jobId);
		await screen.findByText("AI 추천");
		unmount();
		backend.client.bookmarkAI.recommendation.query.mockClear();
		const pending = deferred<ReturnType<typeof bookmarkItem>>();
		backend.client.bookmark.lookup.query.mockReturnValue(pending.promise);
		render(<BookmarkSaveRoot {...props} />, { wrapper });
		await screen.findByText("저장 여부를 확인하고 있어요");
		expect(screen.queryByRole("textbox", { name: "제목 (선택)" })).toBeNull();
		expect(backend.client.bookmarkAI.recommendation.query).not.toHaveBeenCalled();
		await act(async () => pending.resolve(bookmarkItem()));
		await screen.findByRole("button", { name: "기존 북마크 보기" });
		expect(backend.client.bookmarkAI.recommendation.query).not.toHaveBeenCalled();
	});
	it("does not reuse a pending lookup after close and reopen", async () => {
		const old = deferred<null>();
		backend.client.bookmark.lookup.query
			.mockReturnValueOnce(old.promise)
			.mockResolvedValue(bookmarkItem());
		const { props, wrapper, unmount } = mount(jobId);
		await screen.findByText("저장 여부를 확인하고 있어요");
		unmount();
		render(<BookmarkSaveRoot {...props} />, { wrapper });
		await screen.findByRole("button", { name: "기존 북마크 보기" });
		expect(backend.client.bookmark.lookup.query).toHaveBeenCalledTimes(2);
		await act(async () => old.resolve(null));
		expect(backend.client.bookmarkAI.recommendation.query).not.toHaveBeenCalled();
	});
	it("saves a validated recommendation with title, tags, note, thread and collection versions", async () => {
		const { props } = mount(jobId);
		await screen.findByText("AI 추천");
		expect((screen.getByRole("textbox", { name: "URL" }) as HTMLInputElement).readOnly).toBe(true);
		fireEvent.click(screen.getByText("추가 정보 · 태그와 메모"));
		fireEvent.change(screen.getByRole("textbox", { name: "태그 (쉼표로 구분)" }), {
			target: { value: " first, , second , " },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "메모" }), {
			target: { value: "My saved note" },
		});
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		await waitFor(() => expect(props.close).toHaveBeenCalled());
		expect(backend.client.bookmark.save.mutate).toHaveBeenCalledWith({
			url: source.url,
			title: source.title,
			collectionId: collectionB.id,
			collectionVersion: 7,
			recommendationId: jobId,
			tags: ["first", "second"],
			note: "My saved note",
			threadId: source.id,
		});
		expect(backend.success).toHaveBeenCalledWith(
			"북마크를 저장했습니다.",
			expect.objectContaining({ action: { label: "북마크 보기", onClick: expect.any(Function) } })
		);
		backend.success.mock.calls.at(-1)?.[1].action.onClick();
		expect(backend.push).toHaveBeenCalledWith(
			`/main/bookmarks?state=library&bookmark=${bookmarkItem().id}`
		);
	});

	it.each(["library", "trash"] as const)(
		"explains an existing URL in %s without inventing a new saved item",
		async (state) => {
			backend.client.bookmark.save.mutate.mockResolvedValue({
				existing: true,
				item: bookmarkItem({ state }),
			});
			mount(jobId);
			await screen.findByText("AI 추천");
			fireEvent.click(screen.getByRole("button", { name: "저장" }));
			await waitFor(() =>
				expect(backend.success).toHaveBeenCalledWith(
					expect.stringContaining(
						state === "trash" ? "휴지통에 이미 저장한 URL" : "이미 저장한 URL"
					),
					expect.any(Object)
				)
			);
		}
	);

	it("a title change discards the applied recommendation and manual selection sends its current version", async () => {
		mount(jobId);
		await screen.findByText("AI 추천");
		fireEvent.change(screen.getByRole("textbox", { name: "제목 (선택)" }), {
			target: { value: "Edited title" },
		});
		fireEvent.click(screen.getByRole("button", { name: "컬렉션" }));
		fireEvent.click(screen.getByRole("treeitem", { name: "Research" }));
		await screen.findByText("직접 선택");
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		await waitFor(() =>
			expect(backend.client.bookmark.save.mutate).toHaveBeenCalledWith(
				expect.objectContaining({
					title: "Edited title",
					collectionId: collectionA.id,
					collectionVersion: collectionA.version,
					recommendationId: undefined,
					tags: [],
					note: "",
				})
			)
		);
	});

	it("preserves form content after save failure and clears the recommendation token for retry", async () => {
		backend.client.bookmark.save.mutate.mockRejectedValueOnce(new Error("Collection changed"));
		const { props } = mount(jobId);
		await screen.findByText("AI 추천");
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		expect((await screen.findByRole("alert")).textContent).toContain("Collection changed");
		expect(props.close).not.toHaveBeenCalled();
		expect((screen.getByRole("textbox", { name: "제목 (선택)" }) as HTMLInputElement).value).toBe(
			source.title
		);
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		await waitFor(() => expect(props.close).toHaveBeenCalled());
		expect(backend.client.bookmark.save.mutate).toHaveBeenLastCalledWith(
			expect.objectContaining({ recommendationId: undefined })
		);
	});

	it("keeps submission, editing and cancellation locked while a save is pending", async () => {
		const pending = deferred<{ existing: boolean; item: ReturnType<typeof bookmarkItem> }>();
		backend.client.bookmark.save.mutate.mockReturnValue(pending.promise);
		const { props } = mount(jobId);
		await screen.findByText("AI 추천");
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		await screen.findByRole("button", { name: "저장 중…" });
		expect((screen.getByRole("button", { name: "취소" }) as HTMLButtonElement).disabled).toBe(true);
		expect(
			(screen.getByRole("textbox", { name: "제목 (선택)" }) as HTMLInputElement).disabled
		).toBe(true);
		fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
		expect(props.close).not.toHaveBeenCalled();
		fireEvent.submit(
			screen.getByRole("button", { name: "저장 중…" }).closest("form") as HTMLFormElement
		);
		expect(backend.client.bookmark.save.mutate).toHaveBeenCalledTimes(1);
		await act(async () => pending.resolve({ existing: false, item: bookmarkItem() }));
		await waitFor(() => expect(props.close).toHaveBeenCalled());
	});

	it("permits saving without AI and exposes a disabled recommendation retry", async () => {
		backend.client.bookmarkImport.configuration.query.mockResolvedValue({ openrouter: false });
		mount();
		expect((await screen.findByRole("alert")).textContent).toContain("AI 설정이 없어");
		expect(
			(screen.getByRole("button", { name: "요청 다시 확인" }) as HTMLButtonElement).disabled
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		await waitFor(() =>
			expect(backend.client.bookmark.save.mutate).toHaveBeenCalledWith(
				expect.objectContaining({ collectionId: null, recommendationId: undefined })
			)
		);
	});

	it("retries a recommendation status error and applies the result", async () => {
		backend.client.bookmarkAI.recommendation.query.mockRejectedValueOnce(
			new Error("Status not ready")
		);
		const { props } = mount(jobId);
		expect((await screen.findByRole("alert")).textContent).toContain("Status not ready");
		fireEvent.click(screen.getByRole("button", { name: "추천 결과 다시 확인" }));
		await screen.findByText("AI 추천");
		fireEvent.click(screen.getByRole("button", { name: "취소" }));
		expect(props.close).toHaveBeenCalled();
	});

	it("explains a collection loading error and reloads before recommending", async () => {
		backend.client.bookmarkCollection.list.query.mockRejectedValue(
			new Error("Collections offline")
		);
		mount();
		await screen.findByText(/컬렉션을 불러오지 못했습니다/u);
		backend.client.bookmarkCollection.list.query.mockResolvedValue([collectionA, collectionB]);
		fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
		await screen.findByText("AI 추천");
	});

	it("cancels an idle form with Escape and returns focus after it closes", async () => {
		const { props, unmount } = mount(jobId);
		await screen.findByText("AI 추천");
		fireEvent.keyDown(screen.getByRole("textbox", { name: "제목 (선택)" }), { key: "Escape" });
		await waitFor(() => expect(props.close).toHaveBeenCalled());
		unmount();
		await waitFor(() => expect(props.returnFocus).toHaveBeenCalled());
	});

	it("restarts a failed recommendation request from the form", async () => {
		backend.client.bookmarkAI.recommend.mutate.mockRejectedValueOnce(new Error("Provider offline"));
		mount();
		expect((await screen.findByRole("alert")).textContent).toContain("Provider offline");
		fireEvent.click(screen.getByRole("button", { name: "요청 다시 확인" }));
		await screen.findByText("AI 추천");
		expect(backend.client.bookmarkAI.recommend.mutate).toHaveBeenCalledTimes(2);
	});
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookmarkHealthEvidenceSchema } from "@/contracts/bookmark-health.schema";
import {
	bookmarkItem,
	collectionB,
	collections,
	deferred,
	formTransport,
	installBookmarkDom,
	queryHarness,
} from "@/test-support/bookmark-form-fixtures";
import { type BookmarkDetailSelection, BookmarkItemDialog } from "./bookmark-item-dialog";

const backend = vi.hoisted(() => ({
	client: {} as ReturnType<typeof formTransport>,
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/trpc/client", () => ({ useTRPCClient: () => backend.client }));
vi.mock("sonner", () => ({ toast: backend }));

beforeEach(() => {
	backend.client = formTransport();
	installBookmarkDom();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function mount(selection: Partial<BookmarkDetailSelection> = {}) {
	const harness = queryHarness();
	const props = {
		selection: { id: bookmarkItem().id, mode: "details" as const, trigger: null, ...selection },
		collections,
		close: vi.fn(),
		onDirtyChange: vi.fn(),
		changeMode: vi.fn(),
	};
	return { ...render(<BookmarkItemDialog {...props} />, harness), ...harness, props };
}
function proposal(overrides: Partial<ReturnType<typeof bookmarkItem>["proposals"][number]> = {}) {
	return {
		id: "55555555-5555-4555-8555-555555555555",
		job_id: "66666666-6666-4666-8666-666666666666",
		bookmark_id: bookmarkItem().id,
		expected_version: 4,
		expected_review_revision: 2,
		expected_interest_version: 1,
		kind: "classify" as const,
		target_collection_id: collectionB.id,
		new_collection_name: null,
		reason: "Matches the reading topic",
		relevance: "Useful reference",
		state: "pending" as const,
		created_at: "2026-10-01T00:00:00Z",
		...overrides,
	};
}

describe("bookmark item dialog", () => {
	it("renders nothing without a selection", () => {
		const { container } = render(
			<BookmarkItemDialog
				selection={null}
				collections={collections}
				close={vi.fn()}
				onDirtyChange={vi.fn()}
				changeMode={vi.fn()}
			/>
		);
		expect(container.childElementCount).toBe(0);
	});

	it("loads details, records opening safely, and reports copy success and failure", async () => {
		const opened = vi.spyOn(window, "open").mockImplementation(() => null);
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		mount();
		await screen.findByRole("heading", { name: "Saved article" });
		fireEvent.click(screen.getByRole("button", { name: "열기" }));
		await waitFor(() =>
			expect(backend.client.bookmark.open.mutate).toHaveBeenCalledWith({ id: bookmarkItem().id })
		);
		expect(opened).toHaveBeenCalledWith(bookmarkItem().url, "_blank", "noopener,noreferrer");
		fireEvent.click(screen.getByRole("button", { name: "주소 복사" }));
		await waitFor(() => expect(backend.success).toHaveBeenCalledWith("주소를 복사했습니다."));
		writeText.mockRejectedValue(new Error("Clipboard denied"));
		fireEvent.click(screen.getByRole("button", { name: "주소 복사" }));
		await waitFor(() => expect(backend.error).toHaveBeenCalledWith("주소를 복사하지 못했습니다."));
	});

	it("submits edited metadata and the bookmark version captured before a background refresh", async () => {
		const { cache, props } = mount({ mode: "edit" });
		const title = await screen.findByRole("textbox", { name: "제목" });
		fireEvent.change(title, { target: { value: "My draft" } });
		fireEvent.change(screen.getByRole("textbox", { name: "설명" }), {
			target: { value: "New description" },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "태그" }), {
			target: { value: " first, ,second " },
		});
		fireEvent.change(screen.getByRole("textbox", { name: "메모" }), {
			target: { value: "New note" },
		});
		fireEvent.click(screen.getByRole("button", { name: "컬렉션" }));
		fireEvent.click(screen.getByRole("treeitem", { name: "Reading" }));
		act(() =>
			cache.setQueryData(["bookmarks", "detail", bookmarkItem().id], {
				items: [bookmarkItem({ title: "Other session", version: 9 })],
			})
		);
		expect((title as HTMLInputElement).value).toBe("My draft");
		expect((await screen.findByRole("status")).textContent).toContain("다른 곳에서 변경된 항목");
		fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
		await waitFor(() =>
			expect(backend.client.bookmark.edit.mutate).toHaveBeenCalledWith({
				id: bookmarkItem().id,
				version: 4,
				title: "My draft",
				description: "New description",
				note: "New note",
				tags: ["first", "second"],
				collectionId: collectionB.id,
			})
		);
		await waitFor(() => expect(props.close).toHaveBeenCalled());
		expect(props.onDirtyChange).toHaveBeenCalledWith(true);
		expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
	});

	it("preserves the dirty draft on a rejected edit and permits retry", async () => {
		backend.client.bookmark.edit.mutate.mockRejectedValueOnce(new Error("Version conflict"));
		const { props } = mount();
		await screen.findByRole("button", { name: "수정" });
		fireEvent.click(screen.getByRole("button", { name: "수정" }));
		fireEvent.change(screen.getByRole("textbox", { name: "제목" }), {
			target: { value: "Unsent draft" },
		});
		fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
		await waitFor(() => expect(backend.error).toHaveBeenCalledWith("Version conflict"));
		expect((screen.getByRole("textbox", { name: "제목" }) as HTMLInputElement).value).toBe(
			"Unsent draft"
		);
		expect(props.close).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
		await waitFor(() => expect(props.close).toHaveBeenCalled());
	});

	it("switches from details to collection move without marking the draft dirty", async () => {
		const { props } = mount();
		fireEvent.click(await screen.findByRole("button", { name: "컬렉션 이동" }));
		expect(props.changeMode).toHaveBeenCalledWith("move");
		expect(props.onDirtyChange).not.toHaveBeenCalled();
	});

	it("closes a move to the current collection without sending a mutation", async () => {
		const { props } = mount({ mode: "move" });
		fireEvent.click(await screen.findByRole("button", { name: "이동" }));
		expect(backend.client.bookmarkCollection.moveMany.mutate).not.toHaveBeenCalled();
		expect(props.close).toHaveBeenCalled();
	});

	it("requires an explicit target for a bulk move and sends every item version", async () => {
		const other = bookmarkItem({
			id: "77777777-7777-4777-8777-777777777777",
			version: 8,
			collection_id: null,
		});
		const { props } = mount({ mode: "move", items: [bookmarkItem(), other] });
		const move = await screen.findByRole("button", { name: "이동" });
		expect((move as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "컬렉션" }));
		fireEvent.click(screen.getByRole("treeitem", { name: "Reading" }));
		fireEvent.click(move);
		await waitFor(() =>
			expect(backend.client.bookmarkCollection.moveMany.mutate).toHaveBeenCalledWith({
				items: [
					{ id: bookmarkItem().id, version: 4 },
					{ id: other.id, version: 8 },
				],
				collectionId: collectionB.id,
			})
		);
		await waitFor(() => expect(props.close).toHaveBeenCalled());
	});

	it("approves a classification with a trimmed new collection name", async () => {
		const candidate = proposal({ new_collection_name: "Suggested" });
		backend.client.bookmark.detail.query.mockResolvedValue({
			items: [bookmarkItem({ proposals: [candidate] })],
		});
		const { props } = mount({ mode: "proposal" });
		const name = await screen.findByRole("textbox", { name: /새 컬렉션 이름/u });
		fireEvent.change(name, { target: { value: "  New topic  " } });
		fireEvent.click(screen.getByRole("button", { name: "이 항목 승인·이동" }));
		await waitFor(() =>
			expect(backend.client.bookmarkProposal.approve.mutate).toHaveBeenCalledWith({
				items: [{ id: candidate.id, collectionId: collectionB.id, newCollectionName: "New topic" }],
			})
		);
		await waitFor(() => expect(props.close).toHaveBeenCalled());
		expect(props.onDirtyChange).toHaveBeenCalledWith(true);
	});

	it("clears the suggested new collection name when a user chooses an existing collection", async () => {
		const candidate = proposal({ new_collection_name: "Suggested" });
		backend.client.bookmark.detail.query.mockResolvedValue({
			items: [bookmarkItem({ proposals: [candidate] })],
		});
		mount({ mode: "proposal" });
		const select = await screen.findByRole("combobox", { name: "대상 컬렉션" });
		fireEvent.change(select, { target: { value: "" } });
		expect(
			(screen.getByRole("textbox", { name: /새 컬렉션 이름/u }) as HTMLInputElement).value
		).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "이 항목 승인·이동" }));
		await waitFor(() =>
			expect(backend.client.bookmarkProposal.approve.mutate).toHaveBeenCalledWith({
				items: [{ id: candidate.id, collectionId: null, newCollectionName: "" }],
			})
		);
	});

	it.each([
		{ kind: "classify" as const, expected_version: 3 },
		{ kind: "review" as const, expected_review_revision: 1 },
	])("blocks stale $kind approval but allows excluding the proposal", async (overrides) => {
		const candidate = proposal(overrides);
		backend.client.bookmark.detail.query.mockResolvedValue({
			items: [bookmarkItem({ proposals: [candidate] })],
		});
		mount({ mode: "proposal" });
		const approval = await screen.findByRole("button", {
			name: overrides.kind === "classify" ? "이 항목 승인·이동" : "승인·휴지통 이동",
		});
		expect((approval as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/북마크가 변경되었습니다/u)).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "제안 제외" }));
		await waitFor(() =>
			expect(backend.client.bookmarkProposal.approve.mutate).toHaveBeenCalledWith({
				items: [{ id: candidate.id, exclude: true }],
			})
		);
	});

	it("shows an unavailable detail error and reloads after a retry", async () => {
		backend.client.bookmark.detail.query.mockRejectedValueOnce(new Error("Detail unavailable"));
		mount();
		expect((await screen.findByRole("alert")).textContent).toContain("Detail unavailable");
		fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
		await screen.findByRole("heading", { name: "Saved article" });
	});

	it("shows a missing record and a loading state before a detail response", async () => {
		const pending = deferred<{ items: ReturnType<typeof bookmarkItem>[] }>();
		backend.client.bookmark.detail.query.mockReturnValue(pending.promise);
		mount();
		expect(screen.getByRole("status", { name: "상세를 불러오는 중" })).toBeDefined();
		await act(async () => pending.resolve({ items: [] }));
		expect((await screen.findByRole("alert")).textContent).toContain("북마크를 찾을 수 없습니다");
	});

	it("keeps unsafe URLs disabled and restores a trashed bookmark", async () => {
		backend.client.bookmark.detail.query.mockResolvedValue({
			items: [
				bookmarkItem({
					state: "trash",
					url: "javascript:alert(1)",
					title: "",
					description: "",
					note: "",
					collection_id: null,
					previous_collection_path: "Old collection",
					open_count: 3,
					duplicate_count: 2,
					original: { imported: "source" },
					last_review: {
						id: 1,
						bookmark_id: bookmarkItem().id,
						kind: "review",
						evidence_id: null,
						created_at: "2026-10-01T00:00:00Z",
					},
				}),
			],
		});
		const { props } = mount();
		const restore = await screen.findByRole("button", { name: "복원" });
		expect((screen.getByRole("button", { name: "열기" }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByText(/이전 컬렉션: Old collection/u)).toBeDefined();
		expect(screen.getByText(/같은 URL 2개/u)).toBeDefined();
		fireEvent.click(restore);
		await waitFor(() =>
			expect(backend.client.bookmark.restore.mutate).toHaveBeenCalledWith({
				id: bookmarkItem().id,
				version: 4,
			})
		);
		await waitFor(() => expect(props.close).toHaveBeenCalled());
	});

	it("keeps a bookmark and reports a server error before a successful retry", async () => {
		backend.client.bookmark.keep.mutate.mockRejectedValueOnce(new Error("Keep failed"));
		const { props } = mount();
		fireEvent.click(await screen.findByRole("button", { name: "유지" }));
		await waitFor(() =>
			expect(backend.error).toHaveBeenCalledWith(expect.stringContaining("Keep failed"))
		);
		expect(props.close).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "유지" }));
		await waitFor(() => expect(props.close).toHaveBeenCalled());
	});

	it("closes the desktop panel on Escape and restores focus to its trigger", async () => {
		const trigger = document.createElement("button");
		document.body.append(trigger);
		const { props } = mount({ trigger });
		const panel = await screen.findByRole("complementary", { name: "북마크 상세" });
		fireEvent.keyDown(within(panel).getByRole("heading", { name: "북마크 상세" }), {
			key: "Escape",
		});
		expect(props.close).toHaveBeenCalled();
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		trigger.remove();
	});

	it("moves an item to trash after showing the latest health evidence", async () => {
		const item = bookmarkItem({
			opened_at: "2026-10-02T00:00:00Z",
			open_count: 2,
			check: {
				id: "99999999-9999-4999-8999-999999999999",
				bookmark_id: bookmarkItem().id,
				job_id: "66666666-6666-4666-8666-666666666666",
				bookmark_version: 3,
				status: "dead",
				checked_url: null,
				evidence: null,
				evidence_revision: 1,
				reason: "Page returned 404",
				final_url: null,
				http_status: 404,
				checked_at: "2026-10-02T00:00:00Z",
				reviewed_at: null,
			},
		});
		backend.client.bookmark.detail.query.mockResolvedValue({ items: [item] });
		const { props } = mount();
		await screen.findByText("Page returned 404");
		expect(screen.getByText(/수정 전 URL/u)).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "휴지통 이동" }));
		await waitFor(() => expect(props.close).toHaveBeenCalled());
		expect(backend.client.bookmark.trash.mutate).toHaveBeenCalledWith({ id: item.id, version: 4 });
	});

	it("reports approval and open-record failures without closing the detail", async () => {
		vi.spyOn(window, "open").mockImplementation(() => null);
		backend.client.bookmark.open.mutate.mockRejectedValue(new Error("Analytics offline"));
		backend.client.bookmarkProposal.approve.mutate.mockRejectedValue(
			new Error("Proposal conflict")
		);
		backend.client.bookmark.detail.query.mockResolvedValue({
			items: [bookmarkItem({ proposals: [proposal({ kind: "review", relevance: null })] })],
		});
		const { props } = mount({ mode: "proposal" });
		fireEvent.click(await screen.findByRole("button", { name: "승인·휴지통 이동" }));
		await waitFor(() => expect(backend.error).toHaveBeenCalledWith("Proposal conflict"));
		fireEvent.click(screen.getByRole("button", { name: "열기" }));
		await waitFor(() =>
			expect(backend.error).toHaveBeenCalledWith("열기 기록 저장 실패: Analytics offline")
		);
		expect(props.close).not.toHaveBeenCalled();
	});

	it.each([false, true])(
		"dismisses the drawer at a narrow viewport (tablet: %s)",
		async (tablet) => {
			vi.stubGlobal("matchMedia", (query: string) => ({
				matches: tablet && query === "(min-width:768px)",
				media: query,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			}));
			const { props } = mount();
			const drawer = await screen.findByRole("dialog", { name: "북마크 상세" });
			await within(drawer).findByRole("heading", { name: "Saved article" });
			fireEvent.keyDown(drawer, { key: "Escape" });
			await waitFor(() => expect(props.close).toHaveBeenCalled());
		}
	);
});
it("detail keep passes the seen check revision and refreshes a conflict without closing", async () => {
	const item = bookmarkItem();
	item.check = {
		id: "99999999-9999-4999-8999-999999999999",
		job_id: "66666666-6666-4666-8666-666666666666",
		bookmark_id: item.id,
		bookmark_version: item.version,
		status: "healthy",
		reason: "HTTP 200",
		final_url: item.url,
		http_status: 200,
		checked_at: "2026-10-22T00:00:00Z",
		checked_url: item.url,
		evidence: bookmarkHealthEvidenceSchema.parse({ observedAt: "2026-10-22T00:00:00Z" }),
		evidence_revision: 5,
		reviewed_at: null,
	};
	backend.client.bookmark.detail.query.mockResolvedValue({ items: [item] });
	backend.client.bookmark.keep.mutate.mockRejectedValueOnce(new Error("health evidence changed"));
	const { props } = mount();
	fireEvent.click(await screen.findByRole("button", { name: "유지" }));
	await waitFor(() =>
		expect(backend.client.bookmark.keep.mutate).toHaveBeenCalledWith({
			id: item.id,
			version: item.version,
			evidenceId: item.check?.id,
			evidenceRevision: 5,
		})
	);
	await waitFor(() =>
		expect(backend.error).toHaveBeenCalledWith(expect.stringContaining("최신 검사 근거"))
	);
	expect(props.close).not.toHaveBeenCalled();
	expect(screen.getByText("내용 판단 불가")).toBeTruthy();
});

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookmarkItem } from "@/contracts/bookmark.schema";
import { bookmarkHealthEvidenceSchema } from "@/contracts/bookmark-health.schema";
import { uiBookmark, uiCollections } from "@/test-support/collection-ui-fixtures";
import { BookmarkRow } from "./bookmark-row";

const mocks = vi.hoisted(() => ({
	keep: vi.fn(),
	trash: vi.fn(),
	restore: vi.fn(),
	open: vi.fn(),
	change: vi.fn(),
	pending: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
}));
vi.mock("@/trpc/client", () => ({
	useTRPCClient: () => ({
		bookmark: {
			keep: { mutate: mocks.keep },
			trash: { mutate: mocks.trash },
			restore: { mutate: mocks.restore },
			open: { mutate: mocks.open },
		},
	}),
}));
vi.mock("./use-bookmark-actions", () => ({
	useBookmarkChange: () => ({ mutate: mocks.change, isPending: mocks.pending() }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

type Props = ComponentProps<typeof BookmarkRow>;
const clients: QueryClient[] = [];

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.keep.mockResolvedValue(undefined);
	mocks.open.mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	for (const client of clients) client.clear();
	clients.length = 0;
});

function setup(overrides: Partial<Props> = {}) {
	const props: Props = {
		item: uiBookmark(),
		collections: uiCollections,
		view: "library",
		checked: false,
		detailed: false,
		select: vi.fn(),
		detail: vi.fn(),
		startDrag: vi.fn(),
		endDrag: vi.fn(),
		moving: false,
		selectionDisabled: false,
		...overrides,
	};
	const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
	client.setQueryData(["bookmarks", "list"], []);
	clients.push(client);
	const result = render(
		<QueryClientProvider client={client}>
			<BookmarkRow {...props} />
		</QueryClientProvider>
	);
	return { ...result, props, client };
}

async function menu(title = "React guide") {
	const trigger = screen.getByRole("button", { name: `${title} 항목 메뉴` });
	fireEvent.keyDown(trigger, { key: "ArrowDown" });
	await screen.findByRole("menu");
	return trigger;
}

function proposal(
	overrides: Partial<BookmarkItem["proposals"][number]> = {}
): BookmarkItem["proposals"][number] {
	return {
		id: "proposal-1",
		job_id: "job-1",
		bookmark_id: "bookmark-1",
		expected_version: 3,
		expected_review_revision: 0,
		expected_interest_version: 1,
		kind: "classify",
		target_collection_id: "notes",
		new_collection_name: null,
		reason: "Fits the notes collection",
		relevance: null,
		state: "pending",
		created_at: "2026-10-01T00:00:00Z",
		...overrides,
	};
}

function deadCheck(
	overrides: Partial<NonNullable<BookmarkItem["check"]>> = {}
): NonNullable<BookmarkItem["check"]> {
	return {
		id: "check-1",
		bookmark_id: "bookmark-1",
		job_id: "job-1",
		bookmark_version: 3,
		status: "dead",
		checked_url: null,
		evidence: null,
		evidence_revision: 1,
		reason: "The server returned 404",
		final_url: null,
		http_status: 404,
		checked_at: "2026-10-01T00:00:00Z",
		reviewed_at: null,
		...overrides,
	};
}

describe("BookmarkRow", () => {
	it("offers delete directly on each review row without opening details or the menu", () => {
		const { props } = setup({ view: "review" });
		fireEvent.click(screen.getByRole("button", { name: "삭제" }));
		expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ action: "trash", items: [props.item] });
		expect(props.detail).not.toHaveBeenCalled();
		expect(screen.queryByRole("menu")).toBeNull();
	});
	it("separates checkbox selection, details, and dragging and exposes collection context", () => {
		const { props } = setup({ checked: true, detailed: true });
		const checkbox = screen.getByRole("checkbox", { name: "React guide 선택" });
		expect((checkbox as HTMLInputElement).checked).toBe(true);
		fireEvent.click(checkbox);
		expect(props.select).toHaveBeenCalledOnce();
		expect(props.detail).not.toHaveBeenCalled();
		const details = screen.getByRole("button", { name: "React guide 상세 보기" });
		fireEvent.click(details);
		expect(props.detail).toHaveBeenCalledExactlyOnceWith({
			id: props.item.id,
			mode: "details",
			trigger: details,
		});
		const row = screen.getByRole("article");
		expect(row.getAttribute("data-detail-selected")).toBe("true");
		expect(row.getAttribute("draggable")).toBe("true");
		fireEvent.dragStart(row);
		expect(props.startDrag).toHaveBeenCalledWith(expect.anything(), props.item);
		fireEvent.dragEnd(row);
		expect(props.endDrag).toHaveBeenCalledOnce();
		expect(screen.getByTitle("Work / Guides / React")).toBeDefined();
		expect(screen.getByText("react · reading")).toBeDefined();
		expect(screen.getByText("사용 이력 없음")).toBeDefined();
	});

	it.each(["https://example.com/guide", "HTTP://example.com/guide"])(
		"opens a safe external URL %s and refreshes bookmark data",
		async (url) => {
			const { client, props } = setup({ item: uiBookmark({ url, open_count: 2 }) });
			const link = screen.getByRole("link");
			expect(link.getAttribute("href")).toBe(url);
			expect(link.getAttribute("target")).toBe("_blank");
			expect(link.getAttribute("rel")).toBe("noopener noreferrer");
			expect(link.getAttribute("draggable")).toBe("false");
			link.addEventListener("click", (event) => event.preventDefault());
			fireEvent.click(link);
			await waitFor(() =>
				expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ id: props.item.id })
			);
			await waitFor(() =>
				expect(client.getQueryState(["bookmarks", "list"])?.isInvalidated).toBe(true)
			);
			expect(screen.getByText("열기 2회")).toBeDefined();
			expect(props.detail).not.toHaveBeenCalled();
		}
	);

	it.each(["javascript:alert(1)", "data:text/html,hello", "ftp://example.com/file"])(
		"disables navigation and tracking for unsafe URL %s",
		(url) => {
			setup({ item: uiBookmark({ url, title: "", tags: [], collection_id: null }) });
			const anchor = screen.getByTitle(url);
			expect(anchor.getAttribute("href")).toBeNull();
			expect(anchor.getAttribute("aria-disabled")).toBe("true");
			expect(screen.queryByRole("link")).toBeNull();
			fireEvent.click(anchor);
			expect(mocks.open).not.toHaveBeenCalled();
			expect(screen.getByRole("button", { name: `${url} 상세 보기` })).toBeDefined();
			expect(screen.getByTitle("미분류")).toBeDefined();
		}
	);

	it("surfaces open tracking errors", async () => {
		mocks.open.mockRejectedValue(new Error("Unable to record opening"));
		setup();
		const link = screen.getByRole("link");
		link.addEventListener("click", (event) => event.preventDefault());
		fireEvent.click(link);
		await waitFor(() =>
			expect(mocks.error).toHaveBeenCalledExactlyOnceWith("Unable to record opening")
		);
	});

	it.each([
		["상세", "details"],
		["수정", "edit"],
		["컬렉션 이동", "move"],
	])("opens %s from the item menu with its focus return target", async (label, mode) => {
		const { props } = setup();
		const trigger = await menu();
		fireEvent.click(screen.getByRole("menuitem", { name: label }));
		expect(props.detail).toHaveBeenCalledExactlyOnceWith({ id: props.item.id, mode, trigger });
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	});

	it("trashes an item from its menu using the undoable change boundary", async () => {
		const { props } = setup();
		await menu();
		fireEvent.click(screen.getByRole("menuitem", { name: "휴지통 이동" }));
		expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ action: "trash", items: [props.item] });
	});

	it("restores a trashed item and limits its menu to details", async () => {
		const { props } = setup({ view: "trash", item: uiBookmark({ state: "trash" }) });
		expect(screen.getByRole("article").getAttribute("draggable")).toBe("false");
		fireEvent.click(screen.getByRole("button", { name: "복원" }));
		expect(mocks.change).toHaveBeenCalledExactlyOnceWith({
			action: "restore",
			items: [props.item],
		});
		await menu();
		expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["상세"]);
	});

	it("keeps a review item through the shared optimistic boundary", () => {
		const { props } = setup({ view: "review" });
		fireEvent.click(screen.getByRole("button", { name: "유지" }));
		expect(mocks.change).toHaveBeenCalledExactlyOnceWith({ action: "keep", items: [props.item] });
	});
	it("disables keep and delete while the row change is pending", () => {
		mocks.pending.mockReturnValue(true);
		setup({ view: "review" });
		for (const name of ["유지", "삭제"]) {
			const button = screen.getByRole("button", { name });
			expect((button as HTMLButtonElement).disabled).toBe(true);
			fireEvent.click(button);
		}
		expect(mocks.change).not.toHaveBeenCalled();
	});

	it.each(["review", "trash"] as const)(
		"disables %s mutation and selection controls while selection is locked",
		(view) => {
			const { props } = setup({ view, selectionDisabled: true });
			const checkbox = screen.getByRole("checkbox");
			expect((checkbox as HTMLInputElement).disabled).toBe(true);
			(checkbox as HTMLInputElement).click();
			expect(props.select).not.toHaveBeenCalled();
			expect(
				(screen.getByRole("button", { name: "React guide 항목 메뉴" }) as HTMLButtonElement)
					.disabled
			).toBe(true);
			const action = screen.getByRole("button", { name: view === "review" ? "유지" : "복원" });
			expect((action as HTMLButtonElement).disabled).toBe(true);
			fireEvent.click(action);
			expect(mocks.keep).not.toHaveBeenCalled();
			expect(mocks.change).not.toHaveBeenCalled();
			expect(screen.getByRole("article").getAttribute("draggable")).toBe("false");
		}
	);

	it.each([{ moving: true }, { selectionDisabled: true }])(
		"prevents dragging library items while unavailable: %j",
		(overrides) => {
			setup(overrides);
			expect(screen.getByRole("article").getAttribute("draggable")).toBe("false");
		}
	);

	it("shows current unchecked dead-link evidence before classification proposals", () => {
		const { props } = setup({
			view: "review",
			item: uiBookmark({ check: deadCheck(), proposals: [proposal()] }),
		});
		expect(screen.getByText("죽은 링크 의심")).toBeDefined();
		expect(screen.getByTitle("The server returned 404")).toBeDefined();
		expect(screen.queryByText("react · reading")).toBeNull();
		const trigger = screen.getByRole("button", { name: "변경안" });
		fireEvent.click(trigger);
		expect(props.detail).toHaveBeenCalledExactlyOnceWith({
			id: props.item.id,
			mode: "proposal",
			trigger,
		});
	});

	it.each([
		{ bookmark_version: 2 },
		{ reviewed_at: "2026-10-02T00:00:00Z" },
		{ status: "healthy" as const },
	])("hides stale, reviewed, or healthy dead-link warnings: %j", (check) => {
		setup({
			view: "review",
			item: uiBookmark({ check: deadCheck(check), proposals: [proposal({ kind: "review" })] }),
		});
		expect(screen.queryByText("죽은 링크 의심")).toBeNull();
		expect(screen.getByTitle("Fits the notes collection")).toBeDefined();
		expect(screen.getByRole("button", { name: "근거" })).toBeDefined();
	});

	it.each([
		[2, "같은 URL 3개"],
		[0, "오래된 저장 항목"],
	] as const)(
		"explains review without proposals for duplicate count %s",
		(duplicate_count, reason) => {
			setup({ view: "review", item: uiBookmark({ duplicate_count }) });
			expect(screen.getByTitle(reason)).toBeDefined();
		}
	);
});
it("row keep forwards current health evidence to the shared command", async () => {
	const check = deadCheck({
		checked_url: uiBookmark().url,
		evidence: bookmarkHealthEvidenceSchema.parse({ observedAt: "2026-10-22T00:00:00Z" }),
		evidence_revision: 7,
	});
	const { props } = setup({ view: "review", item: uiBookmark({ check }) });
	fireEvent.click(screen.getByRole("button", { name: "유지" }));
	expect(mocks.change).toHaveBeenCalledWith({ action: "keep", items: [props.item] });
	expect(props.item.check?.evidence_revision).toBe(7);
	expect(screen.getByText("죽은 링크 의심")).toBeTruthy();
});

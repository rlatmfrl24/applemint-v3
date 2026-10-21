// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uiBookmark, uiCollections } from "@/test-support/collection-ui-fixtures";
import { BookmarkCollectionTree } from "./bookmark-collection-tree";

type Props = ComponentProps<typeof BookmarkCollectionTree>;

beforeEach(() => {
	sessionStorage.clear();
	vi.stubGlobal(
		"matchMedia",
		vi.fn().mockReturnValue({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		new DOMRect(0, 100, 200, 40)
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function setup(overrides: Partial<Props> = {}) {
	const props: Props = {
		collections: uiCollections,
		selected: "all",
		select: vi.fn(),
		manage: vi.fn(),
		dragged: null,
		moving: false,
		move: vi.fn(),
		startDrag: vi.fn(),
		endDrag: vi.fn(),
		reparent: vi.fn(),
		reorder: vi.fn(),
		...overrides,
	};
	return { ...render(<BookmarkCollectionTree {...props} />), props };
}

function target(name: string) {
	return screen.getByRole("group", { name: `${name} 컬렉션` });
}

function drag(
	target: HTMLElement,
	kind: "dragOver" | "drop" | "dragLeave",
	y = 120,
	relatedTarget: Node | null = null
) {
	const dataTransfer = { dropEffect: "none" };
	const event = createEvent[kind](target, { dataTransfer, relatedTarget });
	Object.defineProperty(event, "clientY", { value: y });
	fireEvent(target, event);
	return { event, dataTransfer };
}

async function menu(name: string) {
	const trigger = screen.getByRole("button", { name: `${name} 메뉴` });
	fireEvent.keyDown(trigger, { key: "ArrowDown" });
	await screen.findByRole("menu");
	return trigger;
}

describe("BookmarkCollectionTree", () => {
	it("navigates and expands branches with the keyboard, preserving selected collection", () => {
		const { props } = setup();
		const work = screen.getByRole("button", { name: "Work" });
		const personal = screen.getByRole("button", { name: "Personal" });
		work.focus();
		fireEvent.keyDown(work, { key: "ArrowRight" });
		const guides = screen.getByRole("button", { name: "Guides" });
		fireEvent.keyDown(work, { key: "ArrowRight" });
		expect(document.activeElement).toBe(guides);
		fireEvent.keyDown(guides, { key: "ArrowLeft" });
		expect(document.activeElement).toBe(work);
		fireEvent.keyDown(work, { key: "ArrowDown" });
		expect(document.activeElement).toBe(guides);
		fireEvent.keyDown(guides, { key: "ArrowUp" });
		expect(document.activeElement).toBe(work);
		fireEvent.keyDown(work, { key: "End" });
		expect(document.activeElement).toBe(personal);
		fireEvent.keyDown(personal, { key: "Home" });
		expect(document.activeElement).toBe(work);
		fireEvent.keyDown(work, { key: "ArrowLeft" });
		expect(screen.queryByRole("button", { name: "Guides" })).toBeNull();
		expect(props.select).not.toHaveBeenCalled();
		fireEvent.click(personal);
		expect(props.select).toHaveBeenCalledExactlyOnceWith("personal");
	});

	it("restores expansion, opens selected ancestors, and persists manual collapse", () => {
		sessionStorage.setItem("bookmark-collection-expansion", JSON.stringify(["personal", 123]));
		setup({ selected: "react" });
		expect(screen.getByRole("button", { name: "React" }).getAttribute("aria-current")).toBe("page");
		expect(JSON.parse(sessionStorage.getItem("bookmark-collection-expansion") ?? "[]")).toEqual([
			"personal",
			"guides",
			"work",
		]);
		fireEvent.click(screen.getByRole("button", { name: "Guides 하위 컬렉션 접기" }));
		expect(screen.queryByRole("button", { name: "React" })).toBeNull();
		expect(JSON.parse(sessionStorage.getItem("bookmark-collection-expansion") ?? "[]")).toEqual([
			"personal",
			"work",
		]);
	});

	it("recovers from invalid stored expansion and searches full collection paths", () => {
		sessionStorage.setItem("bookmark-collection-expansion", "not JSON");
		const { props } = setup();
		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  GUIDES / REACT " } });
		fireEvent.click(screen.getByRole("button", { name: "Work / Guides / React" }));
		expect(props.select).toHaveBeenCalledExactlyOnceWith("react");
		expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
		expect(screen.getByRole("button", { name: "Work" })).toBeDefined();
	});

	it.each(["전체 북마크", "미분류", "휴지통"])("selects the %s view", (label) => {
		const { props } = setup();
		fireEvent.click(screen.getByRole("button", { name: label }));
		expect(props.select).toHaveBeenCalledExactlyOnceWith(
			{ "전체 북마크": "all", 미분류: "", 휴지통: "trash" }[label]
		);
	});

	it("exposes loading and retry feedback without blocking navigation", () => {
		const retry = vi.fn();
		setup({ loading: true, error: "Network unavailable", retry });
		expect(screen.getByRole("region", { name: "컬렉션 트리" }).getAttribute("aria-busy")).toBe(
			"true"
		);
		expect(screen.getByRole("status", { name: "컬렉션을 불러오는 중" })).toBeDefined();
		expect(screen.getByRole("alert").textContent).toContain("Network unavailable");
		fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
		expect(retry).toHaveBeenCalledOnce();
	});

	it.each(["work", "all"])("creates a collection beneath the current scope %s", (selected) => {
		const { props } = setup({ selected });
		const trigger = screen.getByRole("button", { name: "컬렉션 추가" });
		fireEvent.click(trigger);
		expect(props.manage).toHaveBeenCalledExactlyOnceWith({
			mode: "create",
			parentId: selected === "work" ? "work" : null,
			trigger,
		});
	});

	it.each([
		["하위 컬렉션 추가", "create"],
		["이름 수정", "rename"],
		["컬렉션 이동", "move"],
		["컬렉션 삭제", "remove"],
	])("opens %s with the correct collection and focus return target", async (label, mode) => {
		const { props } = setup();
		const trigger = await menu("Work");
		fireEvent.click(screen.getByRole("menuitem", { name: label }));
		expect(props.manage).toHaveBeenCalledExactlyOnceWith(
			mode === "create"
				? { mode, parentId: "work", trigger }
				: { mode, collection: uiCollections[0], parentId: null, trigger }
		);
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	});

	it("limits sibling order controls at boundaries and reorders with the adjacent collection", async () => {
		const { props } = setup();
		await menu("Work");
		expect(screen.getByRole("menuitem", { name: "순서 위로" }).getAttribute("aria-disabled")).toBe(
			"true"
		);
		expect(
			screen.getByRole("menuitem", { name: "한 단계 위로" }).getAttribute("aria-disabled")
		).toBe("true");
		fireEvent.click(screen.getByRole("menuitem", { name: "순서 아래로" }));
		expect(props.reorder).toHaveBeenCalledExactlyOnceWith(
			uiCollections[0],
			uiCollections[4],
			"after"
		);
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		await menu("Personal");
		expect(
			screen.getByRole("menuitem", { name: "순서 아래로" }).getAttribute("aria-disabled")
		).toBe("true");
		fireEvent.click(screen.getByRole("menuitem", { name: "순서 위로" }));
		expect(props.reorder).toHaveBeenLastCalledWith(uiCollections[4], uiCollections[0], "before");
	});

	it("moves a nested collection up to its grandparent", async () => {
		const { props } = setup({ selected: "react" });
		await menu("React");
		fireEvent.click(screen.getByRole("menuitem", { name: "한 단계 위로" }));
		expect(props.reparent).toHaveBeenCalledExactlyOnceWith(uiCollections[2], "work");
	});

	it("disables management and drag targets while a move is pending", () => {
		const { props } = setup({
			moving: true,
			dragged: { kind: "bookmarks", items: [uiBookmark()] },
		});
		expect(
			(screen.getByRole("button", { name: "컬렉션 추가" }) as HTMLButtonElement).disabled
		).toBe(true);
		expect((screen.getByRole("button", { name: "Work 메뉴" }) as HTMLButtonElement).disabled).toBe(
			true
		);
		expect(target("Work").getAttribute("draggable")).toBe("false");
		drag(target("Work"), "dragOver");
		drag(target("Work"), "drop");
		expect(target("Work").getAttribute("data-drop-state")).toBe("idle");
		expect(props.move).not.toHaveBeenCalled();
	});

	it("announces bookmark destinations, moves to a collection, and opens its children", () => {
		const { props } = setup({ dragged: { kind: "bookmarks", items: [uiBookmark()] } });
		const work = target("Work");
		const { event, dataTransfer } = drag(work, "dragOver");
		expect(event.defaultPrevented).toBe(true);
		expect(dataTransfer.dropEffect).toBe("move");
		expect(work.getAttribute("data-drop-state")).toBe("valid");
		expect(screen.getByRole("status").textContent).toContain("Work로 이동");
		drag(work, "drop");
		expect(props.move).toHaveBeenCalledExactlyOnceWith("work");
		expect(screen.getByRole("button", { name: "Guides" })).toBeDefined();
		expect(work.getAttribute("data-drop-state")).toBe("idle");
	});

	it("drops bookmarks into the unclassified collection and clears a departed target", () => {
		const { props } = setup({ dragged: { kind: "bookmarks", items: [uiBookmark()] } });
		const root = screen.getByRole("button", { name: "미분류" });
		drag(root, "dragOver");
		drag(root, "dragLeave");
		expect(root.getAttribute("data-drop-state")).toBe("idle");
		drag(root, "dragOver");
		drag(root, "drop");
		expect(props.move).toHaveBeenCalledExactlyOnceWith(null);
	});

	it.each([
		[105, "before"],
		[135, "after"],
	] as const)("reorders a dragged collection at y=%s", (y, position) => {
		const { props } = setup({ dragged: { kind: "collection", collection: uiCollections[0] } });
		const personal = target("Personal");
		drag(personal, "dragOver", y);
		expect(personal.getAttribute("data-drop-position")).toBe(position);
		expect(personal.closest("li")?.getAttribute("data-insertion")).toBe(position);
		drag(personal, "drop", y);
		expect(props.reorder).toHaveBeenCalledExactlyOnceWith(
			uiCollections[0],
			uiCollections[4],
			position
		);
		expect(props.move).not.toHaveBeenCalled();
	});

	it("rejects dropping a collection into itself, descendants, or a different sibling group", () => {
		const { props } = setup({
			selected: "react",
			dragged: { kind: "collection", collection: uiCollections[0] },
		});
		for (const [name, y] of [
			["Work", 120],
			["React", 120],
			["Notes", 105],
		] as const) {
			const destination = target(name);
			const { dataTransfer } = drag(destination, "dragOver", y);
			expect(destination.getAttribute("data-drop-state")).toBe("invalid");
			expect(dataTransfer.dropEffect).toBe("none");
			drag(destination, "drop", y);
		}
		expect(props.move).not.toHaveBeenCalled();
		expect(props.reorder).not.toHaveBeenCalled();
	});

	it("allows moving a nested collection into another collection or to the root", () => {
		const { props } = setup({
			selected: "react",
			dragged: { kind: "collection", collection: uiCollections[2] },
		});
		drag(target("Personal"), "dragOver");
		expect(screen.getByRole("status").textContent).toContain("Personal의 하위로 이동");
		drag(target("Personal"), "drop");
		expect(props.move).toHaveBeenCalledWith("personal");
		const root = screen.getByRole("region", { name: "최상위 컬렉션 이동 영역" });
		drag(root, "dragOver");
		expect(screen.getByRole("status").textContent).toBe("최상위로 이동");
		drag(root, "drop");
		expect(props.move).toHaveBeenLastCalledWith(null);
	});

	it("reports collection drag start and end, then clears a canceled destination", () => {
		const { props, rerender } = setup({
			dragged: { kind: "collection", collection: uiCollections[0] },
		});
		fireEvent.dragStart(target("Work"));
		expect(props.startDrag).toHaveBeenCalledWith(expect.anything(), uiCollections[0]);
		fireEvent.dragEnd(target("Work"));
		expect(props.endDrag).toHaveBeenCalledOnce();
		drag(target("Personal"), "dragOver");
		rerender(<BookmarkCollectionTree {...props} dragged={null} />);
		expect(target("Personal").getAttribute("data-drop-state")).toBe("idle");
	});
});

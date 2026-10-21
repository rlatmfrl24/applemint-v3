// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uiCollections } from "@/test-support/collection-ui-fixtures";
import { BookmarkCollectionPicker } from "./bookmark-collection-picker";

beforeEach(() => {
	HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function setup(defaultValue: string | null = null) {
	const onChange = vi.fn();
	const props = {
		id: "collection",
		name: "collectionId",
		collections: uiCollections,
		defaultValue,
		onChange,
	};
	const result = render(<BookmarkCollectionPicker {...props} />);
	const trigger = screen.getByRole("button");
	fireEvent.click(trigger);
	return { ...result, onChange, props, trigger };
}

describe("BookmarkCollectionPicker", () => {
	it("opens the selected collection's ancestors and returns a nested selection to the form", () => {
		const { container, onChange, trigger } = setup("react");
		const selected = screen.getByRole("treeitem", { name: "React" });
		expect(document.activeElement).toBe(selected);
		expect(selected.getAttribute("aria-selected")).toBe("true");
		expect(screen.getByRole("treeitem", { name: "Work" }).getAttribute("aria-expanded")).toBe(
			"true"
		);
		fireEvent.click(screen.getByRole("treeitem", { name: "Notes" }));
		expect(onChange).toHaveBeenCalledExactlyOnceWith("notes");
		expect(container.querySelector<HTMLInputElement>('input[name="collectionId"]')?.value).toBe(
			"notes"
		);
		expect(trigger.textContent).toBe("Work / Notes");
		expect(screen.queryByRole("tree")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("navigates visible choices with arrows, Home, and End without changing selection", () => {
		const { onChange } = setup();
		const root = screen.getByRole("treeitem", { name: "미분류" });
		const work = screen.getByRole("treeitem", { name: "Work" });
		fireEvent.keyDown(root, { key: "ArrowDown" });
		expect(document.activeElement).toBe(work);
		fireEvent.keyDown(work, { key: "ArrowRight" });
		expect(work.getAttribute("aria-expanded")).toBe("true");
		fireEvent.keyDown(work, { key: "ArrowRight" });
		const guides = screen.getByRole("treeitem", { name: "Guides" });
		expect(document.activeElement).toBe(guides);
		fireEvent.keyDown(guides, { key: "ArrowLeft" });
		expect(document.activeElement).toBe(work);
		fireEvent.keyDown(work, { key: "ArrowLeft" });
		expect(screen.queryByRole("treeitem", { name: "Guides" })).toBeNull();
		fireEvent.keyDown(work, { key: "End" });
		const personal = screen.getByRole("treeitem", { name: "Personal" });
		expect(document.activeElement).toBe(personal);
		fireEvent.keyDown(personal, { key: "ArrowUp" });
		expect(document.activeElement).toBe(work);
		fireEvent.keyDown(work, { key: "Home" });
		expect(document.activeElement).toBe(root);
		expect(onChange).not.toHaveBeenCalled();
	});

	it.each(["Enter", " "])("selects a focused choice with %j", (key) => {
		const { onChange } = setup();
		fireEvent.keyDown(screen.getByRole("treeitem", { name: "Personal" }), { key });
		expect(onChange).toHaveBeenCalledExactlyOnceWith("personal");
		expect(screen.queryByRole("tree")).toBeNull();
	});

	it("keeps expand buttons separate from selecting their parent", () => {
		const { onChange } = setup();
		fireEvent.click(screen.getByRole("button", { name: "Work 하위 컬렉션 펼치기" }));
		expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "Work" }));
		expect(screen.getByRole("treeitem", { name: "Guides" })).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "Work 하위 컬렉션 접기" }));
		expect(screen.queryByRole("treeitem", { name: "Guides" })).toBeNull();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("finds nested paths case insensitively and chooses a search result", () => {
		const { onChange } = setup();
		const search = screen.getByRole("searchbox");
		fireEvent.change(search, { target: { value: "  GUIDES / react  " } });
		expect(screen.queryByRole("treeitem", { name: "Personal" })).toBeNull();
		const match = screen.getByRole("treeitem", { name: "Work / Guides / React" });
		fireEvent.keyDown(search, { key: "ArrowDown" });
		expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "미분류" }));
		fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
		expect(document.activeElement).toBe(match);
		fireEvent.keyDown(match, { key: "Enter" });
		expect(onChange).toHaveBeenCalledExactlyOnceWith("react");
	});

	it("reports no matches, preserves the root choice, and closes Escape from search", () => {
		const { onChange, trigger } = setup("react");
		const search = screen.getByRole("searchbox");
		fireEvent.change(search, { target: { value: "does not exist" } });
		expect(screen.getByRole("status").textContent).toBe("일치하는 컬렉션이 없습니다.");
		expect(screen.getAllByRole("treeitem")).toHaveLength(1);
		fireEvent.keyDown(search, { key: "Escape" });
		expect(screen.queryByRole("tree")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("clears a collection to null through a custom root choice", () => {
		const onChange = vi.fn();
		const { container } = render(
			<BookmarkCollectionPicker
				id="root"
				name="collectionId"
				collections={uiCollections}
				defaultValue="react"
				rootLabel="Top level"
				onChange={onChange}
			/>
		);
		fireEvent.click(screen.getByRole("button"));
		fireEvent.click(screen.getByRole("treeitem", { name: "Top level" }));
		expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
		expect(container.querySelector<HTMLInputElement>('input[name="collectionId"]')?.value).toBe("");
		expect(screen.getByRole("button").textContent).toBe("Top level");
	});

	it("follows controlled changes and closes an open picker when disabled", () => {
		const { props, rerender, trigger, onChange } = setup();
		rerender(<BookmarkCollectionPicker {...props} value="react" />);
		expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: "React" }));
		fireEvent.click(screen.getByRole("treeitem", { name: "Personal" }));
		expect(onChange).toHaveBeenCalledWith("personal");
		expect(trigger.textContent).toBe("Work / Guides / React");
		fireEvent.click(trigger);
		rerender(<BookmarkCollectionPicker {...props} value={null} disabled />);
		expect((trigger as HTMLButtonElement).disabled).toBe(true);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByRole("tree")).toBeNull();
		fireEvent.click(trigger);
		expect(screen.queryByRole("tree")).toBeNull();
	});

	it("dismisses from the tree with Escape without selecting a different collection", () => {
		const { onChange, trigger } = setup();
		const choice = screen.getByRole("treeitem", { name: "Work" });
		fireEvent.keyDown(choice, { key: "Tab" });
		expect(screen.getByRole("tree")).toBeDefined();
		fireEvent.keyDown(choice, { key: "Escape" });
		expect(screen.queryByRole("tree")).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(onChange).not.toHaveBeenCalled();
	});
});

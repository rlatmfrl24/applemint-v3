// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	collectionA,
	collectionB,
	collections,
	deferred,
	formTransport,
	installBookmarkDom,
	queryHarness,
} from "@/test-support/bookmark-form-fixtures";
import {
	BookmarkCollectionDialog,
	type CollectionDialogSelection,
} from "./bookmark-collection-dialog";

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
function mount(
	selection: CollectionDialogSelection | null = { mode: "create", parentId: null, trigger: null }
) {
	const harness = queryHarness();
	harness.cache.setQueryData(["bookmarks", "collections"], collections);
	const props = { selection, collections, close: vi.fn(), removed: vi.fn() };
	return { ...render(<BookmarkCollectionDialog {...props} />, harness), ...harness, props };
}

describe("bookmark collection dialog", () => {
	it("stays closed without a selection", () => {
		mount(null);
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	it("requires a name and creates a collection under the selected parent", async () => {
		const { props, cache } = mount({ mode: "create", parentId: collectionA.id, trigger: null });
		const input = screen.getByRole("textbox", { name: "컬렉션 이름" }) as HTMLInputElement;
		expect(input.required).toBe(true);
		expect(input.checkValidity()).toBe(false);
		expect((screen.getByRole("combobox", { name: "상위 컬렉션" }) as HTMLSelectElement).value).toBe(
			collectionA.id
		);
		fireEvent.change(input, { target: { value: "New collection" } });
		fireEvent.change(screen.getByRole("combobox", { name: "상위 컬렉션" }), {
			target: { value: collectionB.id },
		});
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		await waitFor(() => expect(props.close).toHaveBeenCalled());
		expect(backend.client.bookmarkCollection.create.mutate).toHaveBeenCalledWith({
			name: "New collection",
			parentId: collectionB.id,
		});
		expect(cache.getQueryData(["bookmarks", "collections"])).toEqual([
			collectionA,
			{ ...collectionB, name: "New collection" },
		]);
		expect(props.removed).not.toHaveBeenCalled();
	});

	it("creates at the root and keeps typed fields available after a server rejection", async () => {
		backend.client.bookmarkCollection.create.mutate.mockRejectedValueOnce(
			new Error("Name already exists")
		);
		const { props } = mount();
		fireEvent.change(screen.getByRole("textbox", { name: "컬렉션 이름" }), {
			target: { value: "New collection" },
		});
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		await waitFor(() => expect(backend.error).toHaveBeenCalledWith("Name already exists"));
		expect(props.close).not.toHaveBeenCalled();
		expect((screen.getByRole("textbox", { name: "컬렉션 이름" }) as HTMLInputElement).value).toBe(
			"New collection"
		);
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		await waitFor(() => expect(props.close).toHaveBeenCalled());
		expect(backend.client.bookmarkCollection.create.mutate).toHaveBeenLastCalledWith({
			name: "New collection",
			parentId: null,
		});
	});

	it.each([false, true])(
		"renames an existing collection with its expected version (nested: %s)",
		async (nested) => {
			const collection = { ...collectionA, parent_id: nested ? collectionB.id : null };
			const { props } = mount({
				mode: "rename",
				collection,
				parentId: collection.parent_id,
				trigger: null,
			});
			expect((screen.getByRole("textbox", { name: "컬렉션 이름" }) as HTMLInputElement).value).toBe(
				collectionA.name
			);
			expect(
				screen.getByText(nested ? /상위 컬렉션: Reading/u : /상위 컬렉션: 최상위/u)
			).toBeDefined();
			fireEvent.change(screen.getByRole("textbox", { name: "컬렉션 이름" }), {
				target: { value: "Renamed" },
			});
			fireEvent.click(screen.getByRole("button", { name: "저장" }));
			await waitFor(() => expect(props.close).toHaveBeenCalled());
			expect(backend.client.bookmarkCollection.rename.mutate).toHaveBeenCalledWith({
				kind: "rename",
				id: collectionA.id,
				version: collectionA.version,
				name: "Renamed",
			});
		}
	);

	it("does not close when renaming fails", async () => {
		backend.client.bookmarkCollection.rename.mutate.mockRejectedValue(
			new Error("Stale collection")
		);
		const { props } = mount({
			mode: "rename",
			collection: collectionA,
			parentId: null,
			trigger: null,
		});
		fireEvent.click(screen.getByRole("button", { name: "저장" }));
		await waitFor(() => expect(backend.error).toHaveBeenCalledWith("Stale collection"));
		expect(props.close).not.toHaveBeenCalled();
	});

	it("moves a collection through the picker while excluding itself and its descendants", async () => {
		const child = {
			...collectionB,
			id: "88888888-8888-4888-8888-888888888888",
			name: "Child",
			parent_id: collectionA.id,
		};
		const harness = queryHarness();
		const close = vi.fn();
		render(
			<BookmarkCollectionDialog
				selection={{ mode: "move", collection: collectionA, parentId: null, trigger: null }}
				collections={[...collections, child]}
				close={close}
				removed={vi.fn()}
			/>,
			harness
		);
		fireEvent.click(screen.getByRole("button", { name: "상위 컬렉션" }));
		expect(screen.queryByRole("treeitem", { name: "Research" })).toBeNull();
		expect(screen.queryByRole("treeitem", { name: "Child" })).toBeNull();
		fireEvent.click(screen.getByRole("treeitem", { name: "Reading" }));
		fireEvent.click(screen.getByRole("button", { name: "이동" }));
		await waitFor(() => expect(close).toHaveBeenCalled());
		expect(backend.client.bookmarkCollection.reparent.mutate).toHaveBeenCalledWith({
			kind: "reparent",
			id: collectionA.id,
			version: collectionA.version,
			parentId: collectionB.id,
		});
	});

	it("can move to the root and preserves the dialog on a failed move", async () => {
		backend.client.bookmarkCollection.reparent.mutate.mockRejectedValueOnce(
			new Error("Move rejected")
		);
		const { props } = mount({
			mode: "move",
			collection: { ...collectionA, parent_id: collectionB.id },
			parentId: collectionB.id,
			trigger: null,
		});
		fireEvent.click(screen.getByRole("button", { name: "상위 컬렉션" }));
		fireEvent.click(screen.getByRole("treeitem", { name: "최상위" }));
		fireEvent.click(screen.getByRole("button", { name: "이동" }));
		await waitFor(() => expect(backend.error).toHaveBeenCalledWith("Move rejected"));
		expect(props.close).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "이동" }));
		await waitFor(() => expect(props.close).toHaveBeenCalled());
		expect(backend.client.bookmarkCollection.reparent.mutate).toHaveBeenLastCalledWith({
			kind: "reparent",
			id: collectionA.id,
			version: collectionA.version,
			parentId: null,
		});
	});

	it("removes a collection and explains how bookmarks and children were preserved", async () => {
		const { props } = mount({
			mode: "remove",
			collection: collectionA,
			parentId: null,
			trigger: null,
		});
		expect(screen.getByText(/북마크는 미분류로 보존/u)).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "삭제" }));
		await waitFor(() => expect(props.removed).toHaveBeenCalledWith(collectionA.id));
		expect(backend.client.bookmarkCollection.remove.mutate).toHaveBeenCalledWith({
			id: collectionA.id,
			version: 3,
		});
		expect(backend.success).toHaveBeenCalledWith(
			expect.stringContaining("북마크 2개는 미분류로, 하위 컬렉션 1개")
		);
		expect(props.close).toHaveBeenCalled();
	});

	it("disables submission and cancellation during a pending delete", async () => {
		const pending = deferred<{
			deletedId: string;
			movedBookmarks: number;
			reparentedCollections: number;
		}>();
		backend.client.bookmarkCollection.remove.mutate.mockReturnValue(pending.promise);
		mount({ mode: "remove", collection: collectionA, parentId: null, trigger: null });
		fireEvent.click(screen.getByRole("button", { name: "삭제" }));
		await waitFor(() =>
			expect((screen.getByRole("button", { name: "취소" }) as HTMLButtonElement).disabled).toBe(
				true
			)
		);
		expect((screen.getByRole("button", { name: "삭제" }) as HTMLButtonElement).disabled).toBe(true);
		await act(async () =>
			pending.resolve({ deletedId: collectionA.id, movedBookmarks: 0, reparentedCollections: 0 })
		);
	});

	it("cancels through the dialog and returns focus to its original trigger", async () => {
		const trigger = document.createElement("button");
		document.body.append(trigger);
		const { props, rerender } = mount({ mode: "create", parentId: null, trigger });
		fireEvent.click(screen.getByRole("button", { name: "취소" }));
		expect(props.close).toHaveBeenCalled();
		rerender(<BookmarkCollectionDialog {...props} selection={null} />);
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		trigger.remove();
	});
});

"use client";
import { ChevronDown, Folder } from "lucide-react";
import { type FocusEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { BookmarkCollection } from "@/contracts/bookmark.schema";
import { collectionPath } from "@/lib/bookmark-collection";
import { collectionAncestors, collectionChildren } from "@/lib/bookmark-tree";
import treeStyles from "./bookmark-tree.module.css";
import {
	BookmarkTreeDisclosure,
	BookmarkTreeLabel,
	bookmarkTreeLabelClass,
} from "./bookmark-tree-row";

export const bookmarkFieldClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
export const bookmarkPickerDialogClass =
	"flex max-h-[90dvh] flex-col overflow-hidden px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:rounded-t-xl sm:px-6 sm:pt-6 sm:pb-6";
export const bookmarkPickerActionsClass =
	"flex shrink-0 justify-end gap-2 border-t pt-3 [&>button]:min-h-11 max-sm:[&>button]:flex-1";

const searchKey = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");

function searchCollections(query: string, collections: BookmarkCollection[]) {
	if (!query) return [];
	return collections.filter(({ id }) => searchKey(collectionPath(id, collections)).includes(query));
}

function CollectionChoiceRow({
	name,
	path,
	selected,
	ancestor,
	expanded,
	toggle,
}: {
	name: string;
	path: string;
	selected: boolean;
	ancestor: boolean;
	expanded?: boolean;
	toggle: () => void;
}) {
	const containsSelection = ancestor && !expanded;
	return (
		<div
			className={treeStyles.collectionRow}
			data-current={selected}
			data-ancestor={ancestor}
			data-parent-node={expanded !== undefined}
			data-hidden-current={containsSelection}
		>
			<BookmarkTreeDisclosure
				name={name}
				expanded={expanded}
				tabIndex={-1}
				onClick={(event) => {
					event.stopPropagation();
					toggle();
					event.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus();
				}}
			/>
			<span className={bookmarkTreeLabelClass}>
				<BookmarkTreeLabel name={name} path={path} marked={selected || containsSelection} />
			</span>
		</div>
	);
}

export function BookmarkCollectionPicker({
	id,
	name,
	collections,
	defaultValue,
	value: controlledValue,
	disabled,
	searchable = true,
	rootLabel = "미분류",
	onChange,
}: {
	id: string;
	name: string;
	collections: BookmarkCollection[];
	defaultValue: string | null;
	value?: string | null;
	disabled?: boolean;
	searchable?: boolean;
	rootLabel?: string;
	onChange?: (id: string | null) => void;
}) {
	const [chosen, setChosen] = useState(defaultValue ?? "");
	const value = controlledValue === undefined ? chosen : (controlledValue ?? "");
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [expanded, setExpanded] = useState(collectionAncestors(defaultValue ?? "", collections));
	const [focused, setFocused] = useState(defaultValue ?? "");
	const selectedAncestors = new Set(collectionAncestors(value, collections));
	const trigger = useRef<HTMLButtonElement>(null);
	const tree = useRef<HTMLDivElement>(null);
	const pendingFocus = useRef<string | null>(null);
	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);
	useEffect(() => {
		setFocused(value);
		const ancestors = collectionAncestors(value, collections);
		setExpanded((previous) =>
			ancestors.every((id) => previous.includes(id))
				? previous
				: [...new Set([...previous, ...ancestors])]
		);
	}, [value, collections]);
	useEffect(() => {
		pendingFocus.current = open ? value : null;
	}, [open, value]);
	useEffect(() => {
		if (
			!open ||
			pendingFocus.current !== value ||
			collectionAncestors(value, collections).some((id) => !expanded.includes(id))
		)
			return;
		const item = [...(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(
			(node) => node.dataset.collectionId === value
		);
		if (item) {
			pendingFocus.current = null;
			item.focus({ preventScroll: true });
			item.scrollIntoView({ block: "nearest" });
		}
	}, [open, value, expanded, collections]);
	function toggle(id: string) {
		setExpanded((previous) =>
			previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
		);
	}
	function choose(id: string) {
		if (disabled) return;
		setChosen(id);
		onChange?.(id || null);
		setFocused(id);
		setOpen(false);
		trigger.current?.focus();
	}
	function focusChoice(event: FocusEvent<HTMLElement>, id: string) {
		if (event.target === event.currentTarget) setFocused(id);
	}
	function key(
		event: KeyboardEvent<HTMLElement>,
		id: string,
		parent: string | null,
		hasChildren: boolean
	) {
		if (event.target !== event.currentTarget) return;
		const nodes = [...(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
		const index = nodes.indexOf(event.currentTarget);
		let next: HTMLElement | undefined;
		switch (event.key) {
			case "ArrowDown":
				next = nodes[index + 1];
				break;
			case "ArrowUp":
				next = nodes[index - 1];
				break;
			case "Home":
				next = nodes[0];
				break;
			case "End":
				next = nodes.at(-1);
				break;
			case "ArrowRight":
				if (hasChildren && !expanded.includes(id)) toggle(id);
				else next = nodes.find((node) => node.dataset.parentId === id && id !== "");
				break;
			case "ArrowLeft":
				if (expanded.includes(id)) toggle(id);
				else if (parent) next = nodes.find((node) => node.dataset.collectionId === parent);
				break;
			case "Enter":
			case " ":
				choose(id);
				break;
			case "Escape":
				setOpen(false);
				trigger.current?.focus();
				break;
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
		next?.focus();
	}
	function nodes(parent: string | null, seen: Set<string>, level: number): React.ReactNode {
		return collectionChildren(parent, collections)
			.filter((collection) => !seen.has(collection.id))
			.map((collection) => {
				const pathIds = new Set(seen).add(collection.id);
				const hasChildren = collectionChildren(collection.id, collections).some(
					(child) => !pathIds.has(child.id)
				);
				const expansion = hasChildren ? expanded.includes(collection.id) : undefined;
				const ancestor = selectedAncestors.has(collection.id);
				return (
					<div
						key={collection.id}
						role="treeitem"
						aria-label={collection.name}
						aria-level={level}
						aria-selected={value === collection.id}
						aria-expanded={expansion}
						aria-description={ancestor && !expansion ? "선택한 하위 컬렉션이 있습니다." : undefined}
						data-collection-id={collection.id}
						data-parent-id={parent}
						tabIndex={focused === collection.id ? 0 : -1}
						data-expanded={Boolean(expansion)}
						className={`${treeStyles.branch} focus-visible:outline-ring cursor-pointer rounded-md focus-visible:outline`}
						onFocus={(event) => focusChoice(event, collection.id)}
						onClick={(event) => {
							event.stopPropagation();
							choose(collection.id);
						}}
						onKeyDown={(event) => key(event, collection.id, parent, hasChildren)}
					>
						<CollectionChoiceRow
							name={collection.name}
							path={collectionPath(collection.id, collections)}
							selected={value === collection.id}
							ancestor={ancestor}
							expanded={expansion}
							toggle={() => toggle(collection.id)}
						/>
						{expansion && (
							<fieldset className={level < 5 ? treeStyles.children : undefined}>
								{nodes(collection.id, pathIds, level + 1)}
							</fieldset>
						)}
					</div>
				);
			});
	}
	const query = searchable ? searchKey(search) : "";
	const matches = searchCollections(query, collections);
	return (
		<div>
			<input type="hidden" name={name} value={value} />
			<button
				ref={trigger}
				id={id}
				type="button"
				className={`${bookmarkFieldClass} flex min-h-11 items-center gap-2 text-left sm:min-h-9`}
				aria-haspopup="tree"
				aria-expanded={open && !disabled}
				aria-controls={`${id}-tree`}
				disabled={disabled}
				onClick={() => {
					if (!open) setSearch("");
					setOpen(!open);
				}}
			>
				<Folder className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
				<span
					className="min-w-0 flex-1 truncate"
					title={collectionPath(value || null, collections)}
				>
					{value ? collectionPath(value, collections) : rootLabel}
				</span>
				<ChevronDown className="size-4 shrink-0" aria-hidden="true" />
			</button>
			{open && !disabled && (
				<div
					ref={tree}
					id={`${id}-tree`}
					role="tree"
					aria-label="컬렉션 선택"
					className={`${treeStyles.theme} ${treeStyles.pickerPanel} mt-1 max-h-[min(20rem,45dvh)] overflow-y-auto overscroll-contain rounded-md border p-1`}
				>
					{searchable && (
						<label className="bg-background sticky top-0 z-10 block p-1">
							<span className="sr-only">컬렉션 검색</span>
							<input
								type="search"
								aria-label="컬렉션 검색"
								value={search}
								className="bg-background h-11 w-full rounded border px-3 text-base sm:text-sm"
								placeholder="컬렉션 검색"
								onChange={(event) => {
									setSearch(event.target.value);
									setFocused("");
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" && !event.nativeEvent.isComposing)
										event.preventDefault();
									if (event.key === "ArrowDown") {
										event.preventDefault();
										tree.current?.querySelector<HTMLElement>('[role="treeitem"]')?.focus();
									}
									if (event.key === "Escape") {
										event.preventDefault();
										event.stopPropagation();
										setOpen(false);
										trigger.current?.focus();
									}
								}}
							/>
						</label>
					)}
					<fieldset className={treeStyles.roots}>
						<div
							role="treeitem"
							aria-label={rootLabel}
							aria-level={1}
							aria-selected={value === ""}
							data-current={value === ""}
							data-collection-id=""
							tabIndex={focused === "" ? 0 : -1}
							className={`${treeStyles.collectionRow} focus-visible:outline-ring cursor-pointer focus-visible:outline`}
							onFocus={() => setFocused("")}
							onClick={() => choose("")}
							onKeyDown={(event) => key(event, "", null, false)}
						>
							<BookmarkTreeDisclosure name={rootLabel} />
							<span className={bookmarkTreeLabelClass}>
								<BookmarkTreeLabel name={rootLabel} marked={value === ""} />
							</span>
						</div>
						{query
							? matches.map((collection) => (
									<div
										key={collection.id}
										role="treeitem"
										aria-label={collectionPath(collection.id, collections)}
										aria-level={1}
										aria-selected={value === collection.id}
										data-current={value === collection.id}
										data-collection-id={collection.id}
										tabIndex={focused === collection.id ? 0 : -1}
										className={`${treeStyles.collectionRow} ${bookmarkTreeLabelClass} cursor-pointer`}
										onFocus={() => setFocused(collection.id)}
										onClick={() => choose(collection.id)}
										onKeyDown={(event) => key(event, collection.id, null, false)}
									>
										<BookmarkTreeLabel
											name={collectionPath(collection.id, collections)}
											marked={value === collection.id}
										/>
									</div>
								))
							: nodes(null, new Set(), 1)}
					</fieldset>
					{query && matches.length === 0 && (
						<p role="status" className="p-3 text-xs">
							일치하는 컬렉션이 없습니다.
						</p>
					)}
				</div>
			)}
		</div>
	);
}

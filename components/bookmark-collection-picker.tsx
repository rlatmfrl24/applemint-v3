"use client";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { type FocusEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { BookmarkCollection } from "@/contracts/bookmark.schema";
import { collectionPath } from "@/lib/bookmark-collection";
import { collectionAncestors, collectionChildren } from "@/lib/bookmark-tree";

export const bookmarkFieldClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";

function CollectionChoiceRow({
	collection,
	selected,
	isOpen,
	hasChildren,
	toggle,
}: {
	collection: BookmarkCollection;
	selected: boolean;
	isOpen: boolean;
	hasChildren: boolean;
	toggle: (id: string) => void;
}) {
	return (
		<div
			className={`flex min-h-9 items-center gap-2 rounded px-2 text-sm ${selected ? "bg-accent font-medium" : "hover:bg-muted"}`}
		>
			{hasChildren ? (
				<button
					type="button"
					tabIndex={-1}
					aria-label={`${collection.name} 하위 컬렉션 ${isOpen ? "접기" : "펼치기"}`}
					className="grid size-8 shrink-0 place-items-center"
					onClick={(event) => {
						event.stopPropagation();
						toggle(collection.id);
						event.currentTarget.closest<HTMLElement>('[role="treeitem"]')?.focus();
					}}
				>
					<ChevronRight className={`size-3.5 ${isOpen ? "rotate-90" : ""}`} />
				</button>
			) : (
				<span className="w-8 shrink-0" />
			)}
			{isOpen ? (
				<FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			) : (
				<Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			)}
			<span className="line-clamp-2 break-words" title={collection.name}>
				{collection.name}
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
	rootLabel = "미분류",
	onChange,
}: {
	id: string;
	name: string;
	collections: BookmarkCollection[];
	defaultValue: string | null;
	value?: string | null;
	disabled?: boolean;
	rootLabel?: string;
	onChange?: (id: string | null) => void;
}) {
	const [chosen, setChosen] = useState(defaultValue ?? "");
	const value = controlledValue === undefined ? chosen : (controlledValue ?? "");
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [expanded, setExpanded] = useState(collectionAncestors(defaultValue ?? "", collections));
	const [focused, setFocused] = useState(defaultValue ?? "");
	const trigger = useRef<HTMLButtonElement>(null);
	const tree = useRef<HTMLDivElement>(null);
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
		if (!open) return;
		const item = [...(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(
			(node) => node.dataset.collectionId === value
		);
		item?.focus();
		item?.scrollIntoView({ block: "nearest" });
	}, [open, value]);
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
				const children = collectionChildren(collection.id, collections).filter(
					(child) => !seen.has(child.id) && child.id !== collection.id
				);
				const isOpen = expanded.includes(collection.id);
				const hasChildren = children.length > 0;
				return (
					<div
						key={collection.id}
						role="treeitem"
						aria-label={collection.name}
						aria-level={level}
						aria-selected={value === collection.id}
						aria-expanded={hasChildren ? isOpen : undefined}
						data-collection-id={collection.id}
						data-parent-id={parent ?? ""}
						tabIndex={focused === collection.id ? 0 : -1}
						className="rounded focus-visible:outline focus-visible:outline-ring"
						onFocus={(event) => focusChoice(event, collection.id)}
						onClick={(event) => {
							event.stopPropagation();
							choose(collection.id);
						}}
						onKeyDown={(event) => key(event, collection.id, parent, hasChildren)}
					>
						<CollectionChoiceRow
							collection={collection}
							selected={value === collection.id}
							isOpen={isOpen}
							hasChildren={hasChildren}
							toggle={toggle}
						/>
						{isOpen && hasChildren && (
							<fieldset className={`${level < 5 ? "ml-3" : ""} border-l pl-1`}>
								{nodes(collection.id, new Set([...seen, collection.id]), level + 1)}
							</fieldset>
						)}
					</div>
				);
			});
	}
	const matches = collections.filter((collection) =>
		collectionPath(collection.id, collections)
			.toLocaleLowerCase()
			.includes(search.trim().toLocaleLowerCase())
	);
	return (
		<div>
			<input type="hidden" name={name} value={value} />
			<button
				ref={trigger}
				id={id}
				type="button"
				className={`${bookmarkFieldClass} flex items-center gap-2 text-left`}
				aria-haspopup="tree"
				aria-expanded={open && !disabled}
				aria-controls={`${id}-tree`}
				disabled={disabled}
				onClick={() => setOpen(!open)}
			>
				<Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
					className="mt-1 max-h-80 overflow-y-auto rounded-md border p-1"
				>
					<label className="sticky top-0 z-10 block bg-background p-1">
						<span className="sr-only">컬렉션 검색</span>
						<input
							type="search"
							aria-label="컬렉션 검색"
							value={search}
							className="h-10 w-full rounded border bg-background px-3 text-sm"
							placeholder="컬렉션 검색"
							onChange={(event) => {
								setSearch(event.target.value);
								setFocused("");
							}}
							onKeyDown={(event) => {
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
					<div
						role="treeitem"
						aria-label={rootLabel}
						aria-level={1}
						aria-selected={value === ""}
						data-collection-id=""
						tabIndex={focused === "" ? 0 : -1}
						className={`cursor-pointer rounded px-3 py-2 text-sm focus-visible:outline focus-visible:outline-ring ${value === "" ? "bg-accent font-medium" : "hover:bg-muted"}`}
						onFocus={() => setFocused("")}
						onClick={() => choose("")}
						onKeyDown={(event) => key(event, "", null, false)}
					>
						{rootLabel}
					</div>
					{search.trim()
						? matches.map((collection) => (
								<div
									key={collection.id}
									role="treeitem"
									aria-label={collectionPath(collection.id, collections)}
									aria-level={1}
									aria-selected={value === collection.id}
									data-collection-id={collection.id}
									tabIndex={focused === collection.id ? 0 : -1}
									className="min-h-11 cursor-pointer break-words rounded px-3 py-2 text-xs hover:bg-muted focus-visible:outline focus-visible:outline-ring"
									onFocus={() => setFocused(collection.id)}
									onClick={() => choose(collection.id)}
									onKeyDown={(event) => key(event, collection.id, null, false)}
								>
									{collectionPath(collection.id, collections)}
								</div>
							))
						: nodes(null, new Set(), 1)}
					{search.trim() && matches.length === 0 && (
						<p role="status" className="p-3 text-xs">
							일치하는 컬렉션이 없습니다.
						</p>
					)}
				</div>
			)}
		</div>
	);
}

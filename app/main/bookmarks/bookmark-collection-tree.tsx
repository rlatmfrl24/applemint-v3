"use client";
import { ChevronRight, Folder, FolderOpen, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import {
	type DragEvent,
	type HTMLAttributes,
	type KeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { BookmarkCollection, BookmarkItem } from "@/contracts/bookmark.schema";
import { collectionPath } from "@/lib/bookmark-collection";
import {
	canReparentCollection,
	collectionAncestors,
	collectionChildren,
	collectionDropPosition,
} from "@/lib/bookmark-tree";
import type { CollectionDialogSelection } from "./bookmark-collection-dialog";
import styles from "./bookmark-collection-tree.module.css";

function treeKey(event: KeyboardEvent<HTMLElement>) {
	const target = event.target as HTMLElement;
	if (!target.matches("button[data-collection-select]")) return;
	const buttons = [
		...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-collection-select]"),
	];
	const index = buttons.indexOf(target as HTMLButtonElement);
	const group = target.closest("li");
	const expander = group?.querySelector<HTMLButtonElement>("button[aria-expanded]");
	switch (event.key) {
		case "ArrowDown":
			buttons[index + 1]?.focus();
			break;
		case "ArrowUp":
			buttons[index - 1]?.focus();
			break;
		case "Home":
			buttons[0]?.focus();
			break;
		case "End":
			buttons.at(-1)?.focus();
			break;
		case "ArrowRight":
			if (expander?.getAttribute("aria-expanded") === "false") expander.click();
			else buttons[index + 1]?.focus();
			break;
		case "ArrowLeft":
			if (expander?.getAttribute("aria-expanded") === "true") expander.click();
			else
				group?.parentElement
					?.closest("li")
					?.querySelector<HTMLButtonElement>("button[data-collection-select]")
					?.focus();
			break;
		default:
			return;
	}
	event.preventDefault();
}
export type BookmarkDrag =
	| { kind: "bookmarks"; items: Pick<BookmarkItem, "id" | "version" | "collection_id">[] }
	| { kind: "collection"; collection: BookmarkCollection };
type Props = {
	loading?: boolean;
	error?: string;
	retry?: () => void;
	collections: BookmarkCollection[];
	selected: string;
	select: (id: string) => void;
	manage: (selection: CollectionDialogSelection) => void;
	dragged: BookmarkDrag | null;
	moving: boolean;
	move: (id: string | null) => void;
	startDrag: (event: DragEvent<HTMLElement>, collection: BookmarkCollection) => void;
	endDrag: () => void;
	reparent: (collection: BookmarkCollection, parent: string | null) => void;
	reorder: (
		collection: BookmarkCollection,
		target: BookmarkCollection,
		position: "before" | "after"
	) => void;
};
type DropTarget = { id: string | null; position: "before" | "inside" | "after" };
type DropHandlers = Pick<
	HTMLAttributes<HTMLElement>,
	"onDragOver" | "onDragLeave" | "onDrop" | "style"
> & {
	"data-drop-state": "idle" | "valid" | "invalid";
	"data-drop-position": DropTarget["position"] | undefined;
};
function dropStyle(
	active: boolean,
	valid: boolean,
	position: DropTarget["position"]
): DropHandlers["style"] {
	if (!active) return undefined;
	return {
		outline:
			!valid || position === "inside"
				? `2px ${valid ? "solid hsl(var(--ring))" : "dashed hsl(var(--destructive))"}`
				: undefined,
		cursor: valid ? "move" : "not-allowed",
	};
}
function CollectionOrderActions({
	collection,
	props,
}: {
	collection: BookmarkCollection;
	props: Props;
}) {
	const siblings = collectionChildren(collection.parent_id, props.collections);
	const index = siblings.findIndex((c) => c.id === collection.id);
	return (
		<>
			<DropdownMenuItem
				disabled={props.moving || index === 0}
				onSelect={() => props.reorder(collection, siblings[index - 1], "before")}
			>
				순서 위로
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={props.moving || index === siblings.length - 1}
				onSelect={() => props.reorder(collection, siblings[index + 1], "after")}
			>
				순서 아래로
			</DropdownMenuItem>
		</>
	);
}
function CollectionLabel({
	collection,
	selected,
	open,
	select,
	path,
}: {
	collection: BookmarkCollection;
	selected: boolean;
	open: boolean;
	select: (id: string) => void;
	path: string;
}) {
	const FolderIcon = open ? FolderOpen : Folder;
	return (
		<button
			type="button"
			data-collection-select
			aria-current={selected ? "page" : undefined}
			className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm focus-visible:outline focus-visible:outline-ring"
			onClick={() => select(collection.id)}
		>
			<FolderIcon className="size-4 shrink-0 text-muted-foreground" />
			<span className="line-clamp-2 break-words" title={path}>
				{collection.name}
			</span>
		</button>
	);
}
function CollectionNode({
	collection,
	props,
	expanded,
	toggle,
	seen,
	dropHandlers,
}: {
	collection: BookmarkCollection;
	props: Props;
	expanded: string[];
	toggle: (id: string) => void;
	seen: Set<string>;
	dropHandlers: (id: string | null) => DropHandlers;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	const openingDialog = useRef(false);
	function manage(selection: CollectionDialogSelection) {
		openingDialog.current = true;
		props.manage(selection);
	}
	const children = collectionChildren(collection.id, props.collections).filter(
		(c) => !seen.has(c.id)
	);
	const open = expanded.includes(collection.id);
	const drop = dropHandlers(collection.id);
	const source =
		props.dragged?.kind === "collection" && props.dragged.collection.id === collection.id;
	return (
		<li
			className={styles.branch}
			data-insertion={
				drop["data-drop-state"] === "valid" && drop["data-drop-position"] !== "inside"
					? drop["data-drop-position"]
					: undefined
			}
		>
			<fieldset
				aria-label={`${collection.name} 컬렉션`}
				{...drop}
				data-collection-id={collection.id}
				draggable={!props.moving}
				onDragStart={(event) => {
					event.stopPropagation();
					props.startDrag(event, collection);
				}}
				onDragEnd={props.endDrag}
				style={{ ...drop.style, opacity: source ? 0.45 : undefined }}
				className={`group flex min-h-9 min-w-0 items-center rounded-md ${drop["data-drop-state"] === "valid" && drop["data-drop-position"] === "inside" ? "bg-accent" : ""} ${props.selected === collection.id ? "bg-accent text-accent-foreground" : "hover:bg-muted/70"}`}
			>
				{children.length > 0 ? (
					<button
						type="button"
						className="grid size-8 shrink-0 place-items-center rounded focus-visible:outline focus-visible:outline-ring"
						aria-label={`${collection.name} 하위 컬렉션 ${open ? "접기" : "펼치기"}`}
						aria-expanded={open}
						onClick={() => toggle(collection.id)}
					>
						<ChevronRight
							className={`size-3.5 motion-safe:transition-transform ${open ? "rotate-90" : ""}`}
						/>
					</button>
				) : (
					<span className="w-8 shrink-0" />
				)}
				<CollectionLabel
					collection={collection}
					selected={props.selected === collection.id}
					open={open}
					select={props.select}
					path={collectionPath(collection.id, props.collections)}
				/>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							ref={trigger}
							disabled={props.moving}
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							aria-label={`${collection.name} 메뉴`}
						>
							<MoreHorizontal className="size-3.5" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						onCloseAutoFocus={(event) => {
							if (openingDialog.current) event.preventDefault();
							openingDialog.current = false;
						}}
					>
						<DropdownMenuItem
							onSelect={() =>
								manage({ mode: "create", parentId: collection.id, trigger: trigger.current })
							}
						>
							하위 컬렉션 추가
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() =>
								manage({
									mode: "rename",
									collection,
									parentId: collection.parent_id,
									trigger: trigger.current,
								})
							}
						>
							이름 수정
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={props.moving}
							onSelect={() =>
								manage({
									mode: "move",
									collection,
									parentId: collection.parent_id,
									trigger: trigger.current,
								})
							}
						>
							컬렉션 이동
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={props.moving || !collection.parent_id}
							onSelect={() =>
								props.reparent(
									collection,
									props.collections.find((c) => c.id === collection.parent_id)?.parent_id ?? null
								)
							}
						>
							한 단계 위로
						</DropdownMenuItem>
						<CollectionOrderActions collection={collection} props={props} />
						<DropdownMenuItem
							className="text-destructive"
							onSelect={() =>
								manage({
									mode: "remove",
									collection,
									parentId: collection.parent_id,
									trigger: trigger.current,
								})
							}
						>
							컬렉션 삭제
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</fieldset>
			{open && children.length > 0 && (
				<ul className={`${seen.size < 5 ? "ml-3" : ""} border-border border-l pl-1`}>
					{children.map((child) => (
						<CollectionNode
							key={child.id}
							collection={child}
							props={props}
							expanded={expanded}
							toggle={toggle}
							seen={new Set([...seen, child.id])}
							dropHandlers={dropHandlers}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
export function BookmarkCollectionTree(props: Props) {
	const [expanded, setExpanded] = useState<string[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [search, setSearch] = useState("");
	const [mobileOpen, setMobileOpen] = useState(false);
	const [mobile, setMobile] = useState(false);
	useEffect(() => {
		const media = window.matchMedia("(max-width:767px)");
		const update = () => {
			setMobile(media.matches);
			if (!media.matches) setMobileOpen(false);
		};
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	function select(id: string) {
		props.select(id);
		setMobileOpen(false);
	}
	const [dropTarget, setDropTarget] = useState<DropTarget>();
	useEffect(() => {
		if (!props.dragged) setDropTarget(undefined);
	}, [props.dragged]);
	function canDrop(target: DropTarget) {
		if (props.dragged?.kind !== "collection") return true;
		const source = props.dragged.collection;
		if (target.position === "inside")
			return canReparentCollection(source.id, target.id, props.collections);
		const sibling = props.collections.find((c) => c.id === target.id);
		return source.id !== sibling?.id && source.parent_id === sibling?.parent_id;
	}
	function pointerTarget(event: DragEvent<HTMLElement>, id: string | null): DropTarget {
		const rect = event.currentTarget.getBoundingClientRect();
		return {
			id,
			position:
				id && props.dragged?.kind === "collection"
					? collectionDropPosition(event.clientY - rect.top, rect.height)
					: "inside",
		};
	}
	function dropHandlers(id: string | null): DropHandlers {
		const active = Boolean(props.dragged) && dropTarget?.id === id;
		const target = active && dropTarget ? dropTarget : { id, position: "inside" as const };
		const valid = canDrop(target);
		return {
			"data-drop-state": active ? (valid ? "valid" : "invalid") : "idle",
			"data-drop-position": active ? target.position : undefined,
			style: dropStyle(active, valid, target.position),
			onDragOver: (event) => hoverTarget(event, id),
			onDragLeave: (event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null))
					setDropTarget(undefined);
			},
			onDrop: (event) => dropAt(event, id),
		};
	}
	function hoverTarget(event: DragEvent<HTMLElement>, id: string | null) {
		if (!props.dragged || props.moving) return;
		const next = pointerTarget(event, id);
		const allowed = canDrop(next);
		if (allowed) event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = allowed ? "move" : "none";
		setDropTarget((previous) =>
			previous?.id === next.id && previous.position === next.position ? previous : next
		);
	}
	function dropAt(event: DragEvent<HTMLElement>, id: string | null) {
		const next = pointerTarget(event, id);
		if (!props.dragged || props.moving || !canDrop(next)) return;
		event.preventDefault();
		event.stopPropagation();
		setDropTarget(undefined);
		applyDrop(next);
	}
	function applyDrop(target: DropTarget) {
		if (props.dragged?.kind === "collection" && target.position !== "inside") {
			const anchor = props.collections.find((c) => c.id === target.id);
			if (anchor) props.reorder(props.dragged.collection, anchor, target.position);
			return;
		}
		const { id } = target;
		if (id) setExpanded((previous) => [...new Set([...previous, id])]);
		props.move(id);
	}
	const ancestors = collectionAncestors(props.selected, props.collections).join(",");
	useEffect(() => {
		try {
			const stored: unknown = JSON.parse(
				sessionStorage.getItem("bookmark-collection-expansion") ?? "[]"
			);
			if (Array.isArray(stored))
				setExpanded(stored.filter((id): id is string => typeof id === "string"));
		} catch {}
		setLoaded(true);
	}, []);
	useEffect(() => {
		if (ancestors) setExpanded((previous) => [...new Set([...previous, ...ancestors.split(",")])]);
	}, [ancestors]);
	useEffect(() => {
		if (loaded)
			try {
				sessionStorage.setItem("bookmark-collection-expansion", JSON.stringify(expanded));
			} catch {}
	}, [expanded, loaded]);
	const navigation = (
		<nav
			id="bookmark-collection-navigation"
			aria-label="북마크 탐색"
			data-open={mobile ? mobileOpen : true}
			className={`${styles.navigation} text-sm`}
		>
			{[
				{ id: "all", label: "전체 북마크" },
				{ id: "", label: "미분류" },
				{ id: "trash", label: "휴지통" },
			].map((entry) => (
				<button
					key={entry.id}
					{...(entry.id === "" && props.dragged?.kind === "bookmarks" ? dropHandlers(null) : {})}
					type="button"
					aria-current={props.selected === entry.id ? "page" : undefined}
					className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left focus-visible:outline focus-visible:outline-ring ${props.dragged?.kind === "bookmarks" && dropTarget?.id === null && entry.id === "" ? "bg-accent" : ""} ${props.selected === entry.id ? "bg-accent font-medium" : "hover:bg-muted/70"}`}
					onClick={() => select(entry.id)}
				>
					{entry.id === "trash" && <Trash2 className="size-3.5" aria-hidden="true" />}
					{entry.label}
				</button>
			))}
			<section
				aria-labelledby="bookmark-collections-heading"
				className={`${styles.collections} mt-3 border-t pt-3`}
			>
				<section
					aria-label="최상위 컬렉션 이동 영역"
					{...(props.dragged?.kind === "collection" ? dropHandlers(null) : {})}
					className={`${styles.rootTarget} flex items-center justify-between rounded-md bg-background pl-3`}
					title="컬렉션을 여기에 놓으면 최상위로 이동합니다."
				>
					<h2
						id="bookmark-collections-heading"
						className="m-0 border-0 p-0 font-medium text-muted-foreground text-xs"
					>
						{props.dragged?.kind === "collection" ? "최상위로 이동" : "컬렉션"}
					</h2>
					<Button
						id="bookmark-collection-add"
						disabled={props.moving}
						variant="ghost"
						size="icon"
						className="size-8"
						aria-label="컬렉션 추가"
						onClick={(event) =>
							props.manage({
								mode: "create",
								parentId: props.collections.some((collection) => collection.id === props.selected)
									? props.selected
									: null,
								trigger: event.currentTarget,
							})
						}
					>
						<Plus className="size-4" />
					</Button>
				</section>
				{props.error && (
					<div role="alert" className="p-2 text-xs">
						<p>{props.error}</p>
						<Button size="sm" variant="ghost" onClick={props.retry}>
							다시 불러오기
						</Button>
					</div>
				)}
				<label className="mx-2 mb-2 block">
					<span className="sr-only">컬렉션 검색</span>
					<input
						type="search"
						aria-label="컬렉션 검색"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-xs"
						placeholder="컬렉션 검색"
					/>
				</label>
				<section
					className={styles.treeScroll}
					aria-label="컬렉션 트리"
					aria-busy={props.loading}
					onKeyDown={treeKey}
				>
					{props.loading && (
						<div role="status" aria-label="컬렉션을 불러오는 중" className="space-y-4 p-3">
							{[0, 1, 2, 3, 4].map((index) => (
								<Skeleton key={index} className="h-5 w-4/5" />
							))}
						</div>
					)}
					{search.trim() ? (
						<div className="space-y-1">
							{props.collections
								.filter((collection) =>
									collectionPath(collection.id, props.collections)
										.toLocaleLowerCase()
										.includes(search.trim().toLocaleLowerCase())
								)
								.map((collection) => (
									<button
										key={collection.id}
										type="button"
										className="min-h-11 w-full break-words rounded-md px-3 py-2 text-left text-xs hover:bg-muted focus-visible:outline focus-visible:outline-ring"
										onClick={() => {
											select(collection.id);
											setSearch("");
										}}
									>
										{collectionPath(collection.id, props.collections)}
									</button>
								))}
						</div>
					) : (
						<ul className="mt-1">
							{collectionChildren(null, props.collections).map((collection) => (
								<CollectionNode
									key={collection.id}
									collection={collection}
									props={{
										...props,
										select,
										manage: (selection) => {
											setMobileOpen(false);
											props.manage(selection);
										},
									}}
									expanded={expanded}
									toggle={(id) =>
										setExpanded((previous) =>
											previous.includes(id)
												? previous.filter((value) => value !== id)
												: [...previous, id]
										)
									}
									seen={new Set([collection.id])}
									dropHandlers={dropHandlers}
								/>
							))}
						</ul>
					)}
				</section>
			</section>
		</nav>
	);
	return (
		<aside className={`${styles.sidebar} min-w-0`}>
			{mobile ? (
				<Drawer open={mobileOpen} shouldScaleBackground={false} onOpenChange={setMobileOpen}>
					<button
						type="button"
						className="flex min-h-11 items-center gap-2 text-sm"
						aria-expanded={mobileOpen}
						onClick={() => setMobileOpen(true)}
					>
						<ChevronRight className="size-4" />
						북마크 탐색
					</button>
					<DrawerContent
						className={`${styles.mobileDrawer} max-h-[90dvh] bg-background p-4 pb-[max(16px,env(safe-area-inset-bottom))]`}
					>
						<div className="my-2 flex items-center justify-between">
							<DrawerPrimitive.Title className="m-0 border-0 p-0 text-base">
								컬렉션 탐색
							</DrawerPrimitive.Title>
							<Button variant="ghost" onClick={() => setMobileOpen(false)}>
								닫기
							</Button>
						</div>
						<DrawerPrimitive.Description className="sr-only">
							컬렉션과 북마크 보기를 선택합니다.
						</DrawerPrimitive.Description>
						{navigation}
					</DrawerContent>
				</Drawer>
			) : (
				navigation
			)}
			<DragStatus dragged={props.dragged} target={dropTarget} collections={props.collections} />
		</aside>
	);
}

function DragStatus({
	dragged,
	target,
	collections,
}: {
	dragged: BookmarkDrag | null;
	target: DropTarget | undefined;
	collections: BookmarkCollection[];
}) {
	const message = !dragged
		? "사이: 순서 변경 · 가운데: 하위 이동"
		: dragged.kind === "bookmarks"
			? `북마크 ${dragged.items.length}개 · ${target === undefined ? "컬렉션 또는 미분류에 놓아 이동" : `${collectionPath(target.id, collections)}로 이동`}`
			: collectionDragMessage(dragged.collection, target, collections);
	return (
		<p
			role="status"
			title={message}
			className={`${styles.dragStatus} break-words px-3 text-muted-foreground text-xs`}
		>
			{message}
		</p>
	);
}
function collectionDragMessage(
	collection: BookmarkCollection,
	target: DropTarget | undefined,
	collections: BookmarkCollection[]
) {
	if (!target)
		return `컬렉션 “${collection.name}” · 항목 사이에 놓아 순서 변경 · 가운데에 놓아 하위 이동 · 컬렉션 제목에 놓아 최상위 이동`;
	if (target.position !== "inside") {
		const sibling = collections.find((c) => c.id === target.id);
		return sibling && sibling.id !== collection.id && sibling.parent_id === collection.parent_id
			? `“${sibling.name}” ${target.position === "before" ? "앞" : "뒤"}으로 순서 변경`
			: "순서 변경은 같은 계층의 다른 컬렉션 사이에 놓으세요.";
	}
	if (!canReparentCollection(collection.id, target.id, collections))
		return "자기 자신이나 하위 컬렉션으로 이동할 수 없습니다.";
	return target.id === null
		? "최상위로 이동"
		: `${collectionPath(target.id, collections)}의 하위로 이동`;
}

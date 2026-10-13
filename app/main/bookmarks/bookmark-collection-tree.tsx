"use client";
import { ChevronRight, Folder, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BookmarkCollection } from "@/contracts/bookmark.schema";
import { collectionAncestors, collectionChildren } from "@/lib/bookmark-collection";
import type { CollectionDialogSelection } from "./bookmark-collection-dialog";

type Props = {
	collections: BookmarkCollection[];
	selected: string;
	select: (id: string) => void;
	manage: (selection: CollectionDialogSelection) => void;
};
function CollectionNode({
	collection,
	props,
	expanded,
	toggle,
	seen,
}: {
	collection: BookmarkCollection;
	props: Props;
	expanded: string[];
	toggle: (id: string) => void;
	seen: Set<string>;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	const children = collectionChildren(collection.id, props.collections).filter(
		(c) => !seen.has(c.id)
	);
	const open = expanded.includes(collection.id);
	return (
		<li>
			<div
				className={`group flex min-h-9 items-center rounded-md ${props.selected === collection.id ? "bg-accent text-accent-foreground" : "hover:bg-muted/70"}`}
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
				<button
					type="button"
					aria-current={props.selected === collection.id ? "page" : undefined}
					className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm focus-visible:outline focus-visible:outline-ring"
					onClick={() => props.select(collection.id)}
				>
					<Folder className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="truncate" title={collection.name}>
						{collection.name}
					</span>
				</button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							ref={trigger}
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							aria-label={`${collection.name} 메뉴`}
						>
							<MoreHorizontal className="size-3.5" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
						<DropdownMenuItem
							onSelect={() =>
								props.manage({ mode: "create", parentId: collection.id, trigger: trigger.current })
							}
						>
							하위 컬렉션 추가
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() =>
								props.manage({
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
							className="text-destructive"
							onSelect={() =>
								props.manage({
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
			</div>
			{open && children.length > 0 && (
				<ul className="ml-4 border-border border-l pl-1">
					{children.map((child) => (
						<CollectionNode
							key={child.id}
							collection={child}
							props={props}
							expanded={expanded}
							toggle={toggle}
							seen={new Set([...seen, child.id])}
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
	const [mobileOpen, setMobileOpen] = useState(false);
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
	return (
		<aside className="min-w-0 space-y-3 md:sticky md:top-4 md:self-start">
			<div className="flex items-center justify-between px-2">
				<span className="hidden font-medium text-sm md:inline">컬렉션</span>
				<button
					type="button"
					className="flex items-center gap-2 font-medium text-sm md:hidden"
					aria-expanded={mobileOpen}
					aria-controls="bookmark-collection-navigation"
					onClick={() => setMobileOpen(!mobileOpen)}
				>
					<ChevronRight className={`size-4 ${mobileOpen ? "rotate-90" : ""}`} />
					컬렉션 탐색
				</button>
				<Button
					id="bookmark-collection-add"
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label="컬렉션 추가"
					onClick={(event) =>
						props.manage({
							mode: "create",
							parentId: props.selected === "all" || props.selected === "" ? null : props.selected,
							trigger: event.currentTarget,
						})
					}
				>
					<Plus className="size-4" />
				</Button>
			</div>
			<nav
				id="bookmark-collection-navigation"
				aria-label="북마크 컬렉션"
				className={`${mobileOpen ? "block" : "hidden"} max-h-[65dvh] overflow-y-auto pr-1 text-sm md:block`}
			>
				{[
					{ id: "all", label: "전체 북마크" },
					{ id: "", label: "미분류" },
				].map((entry) => (
					<button
						type="button"
						key={entry.id}
						aria-current={props.selected === entry.id ? "page" : undefined}
						className={`mb-1 block w-full rounded-md px-3 py-2 text-left ${props.selected === entry.id ? "bg-accent font-medium" : "hover:bg-muted/70"}`}
						onClick={() => props.select(entry.id)}
					>
						{entry.label}
					</button>
				))}
				<ul className="mt-3">
					{collectionChildren(null, props.collections).map((collection) => (
						<CollectionNode
							key={collection.id}
							collection={collection}
							props={props}
							expanded={expanded}
							toggle={(id) =>
								setExpanded((previous) =>
									previous.includes(id)
										? previous.filter((value) => value !== id)
										: [...previous, id]
								)
							}
							seen={new Set([collection.id])}
						/>
					))}
				</ul>
			</nav>
		</aside>
	);
}

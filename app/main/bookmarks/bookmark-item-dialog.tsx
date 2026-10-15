"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Drawer as DrawerPrimitive } from "vaul";
import {
	BookmarkCollectionPicker,
	bookmarkFieldClass,
} from "@/components/bookmark-collection-picker";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import type { BookmarkCollection, BookmarkItem } from "@/contracts/bookmark.schema";
import { collectionPath } from "@/lib/bookmark-collection";
import { useTRPCClient } from "@/trpc/client";
import styles from "./bookmark-detail.module.css";

const healthLabels = {
	healthy: "정상",
	dead: "죽은 링크 의심",
	restricted: "접근 제한",
	temporary: "일시 오류",
	uncheckable: "검사 불가",
};
function proposalIsStale(item: BookmarkItem, proposal: BookmarkItem["proposals"][number]) {
	return (
		item.version !== proposal.expected_version ||
		(proposal.kind === "review" && item.review_revision !== proposal.expected_review_revision)
	);
}

function BookmarkUsage({ item }: { item: BookmarkItem }) {
	return (
		<>
			<p className="text-muted-foreground text-xs">
				저장 {new Date(item.saved_at).toLocaleDateString("ko-KR")} ·{" "}
				{item.open_count === 0
					? "사용 이력 없음 (과거 사용 여부 불명)"
					: `Applemint 열기 ${item.open_count}회 · 최근 ${item.opened_at ? new Date(item.opened_at).toLocaleDateString("ko-KR") : "없음"}`}{" "}
				{item.duplicate_count > 0 && `· 같은 URL ${item.duplicate_count}개`}
			</p>
			{item.last_review && (
				<p className="text-muted-foreground text-xs">
					최근 유지 검토 {new Date(item.last_review.created_at).toLocaleString("ko-KR")}
				</p>
			)}
		</>
	);
}

function BookmarkMoveForm({
	item,
	items = [item],
	collections,
	onDone,
}: {
	item: BookmarkItem;
	items?: BookmarkItem[];
	collections: BookmarkCollection[];
	onDone: () => void;
}) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const fieldId = useId();
	const [chosen, setChosen] = useState(items.length === 1);
	const move = useMutation({
		mutationFn: (collectionId: string | null) =>
			trpc.bookmarkCollection.moveMany.mutate({
				items: items.map(({ id, version }) => ({ id, version })),
				collectionId,
			}),
		onSuccess: async (result) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			onDone();
			toast.success(`북마크 ${result.applied}개를 이동했습니다.`);
		},
		onError: async (error) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.error(error.message);
		},
	});
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const collectionId = String(new FormData(event.currentTarget).get("collection") ?? "") || null;
		if (items.every((item) => collectionId === item.collection_id)) {
			onDone();
			return;
		}
		move.mutate(collectionId);
	}
	return (
		<form className="space-y-3" onSubmit={submit}>
			<p className="break-words text-sm">
				{items.length === 1
					? item.title || item.url
					: `선택한 북마크 ${items.length}개를 함께 이동합니다.`}
			</p>
			<label htmlFor={`${fieldId}collection`}>컬렉션</label>
			<BookmarkCollectionPicker
				id={`${fieldId}collection`}
				name="collection"
				collections={collections}
				defaultValue={item.collection_id}
				disabled={move.isPending}
				onChange={() => setChosen(true)}
			/>
			<Button type="submit" disabled={move.isPending || !chosen}>
				{move.isPending ? "이동 중…" : "이동"}
			</Button>
		</form>
	);
}

function BookmarkItemDetail({
	item,
	collections,
	mode,
	onDone,
	onDirtyChange,
}: {
	item: BookmarkItem;
	collections: BookmarkCollection[];
	mode: "details" | "edit" | "proposal";
	onDone: () => void;
	onDirtyChange: (dirty: boolean) => void;
}) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const [editing, setEditing] = useState(mode === "edit");
	const [editVersion, setEditVersion] = useState(item.version);
	const fieldId = useId();
	const mutate = useMutation({
		mutationFn: async (action: "trash" | "restore" | "keep") =>
			trpc.bookmark[action].mutate({ id: item.id, version: item.version }),
		onSuccess: async (_item, action) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			onDone();
			toast.success(
				{
					trash: "휴지통으로 이동했습니다.",
					restore: "복원했습니다.",
					keep: "유지 검토를 기록했습니다.",
				}[action]
			);
		},
		onError: (e) => toast.error(e.message),
	});
	const edit = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmark.edit.mutate>[0]) =>
			trpc.bookmark.edit.mutate(input),
		onSuccess: async () => {
			setEditing(false);
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			onDone();
			toast.success("변경했습니다.");
		},
		onError: (e) => toast.error(e.message),
	});
	const apply = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmarkProposal.approve.mutate>[0]) =>
			trpc.bookmarkProposal.approve.mutate(input),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			onDone();
			toast.success("제안을 처리했습니다.");
		},
		onError: (e) => toast.error(e.message),
	});
	const recordOpen = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmark.open.mutate>[0]) =>
			trpc.bookmark.open.mutate(input),
		onSuccess: () => cache.invalidateQueries({ queryKey: ["bookmarks"] }),
		onError: (e) => toast.error(`열기 기록 저장 실패: ${e.message}`),
	});
	const pending = mutate.isPending || apply.isPending || edit.isPending;
	const safeUrl = /^https?:\/\//iu.test(item.url);
	return (
		<div className="space-y-3">
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<h2 className="break-words border-0 p-0 font-medium text-base">
						{item.title || item.url}
					</h2>
					<p className="break-all text-muted-foreground text-xs">{item.url}</p>
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => {
							void navigator.clipboard.writeText(item.url).then(
								() => toast.success("주소를 복사했습니다."),
								() => toast.error("주소를 복사하지 못했습니다.")
							);
						}}
					>
						주소 복사
					</Button>
					<p className="mt-1 text-xs">
						{collectionPath(item.collection_id, collections)}{" "}
						{item.tags.length > 0 && `· ${item.tags.join(", ")}`}
						{!item.collection_id && item.previous_collection_path && (
							<span className="block break-words text-muted-foreground">
								이전 소속: {item.previous_collection_path}
							</span>
						)}
					</p>
				</div>
			</div>
			{item.description && (
				<p className="line-clamp-3 text-muted-foreground text-sm">{item.description}</p>
			)}
			{item.note && <p className="whitespace-pre-wrap break-words text-sm">{item.note}</p>}
			<BookmarkUsage item={item} />
			{item.check && (
				<div className="rounded-md bg-muted p-2 text-sm">
					<strong>{healthLabels[item.check.status]}</strong>
					{item.check.bookmark_version !== item.version && " (수정 전 검사)"}
					<p>{item.check.reason}</p>
					<p className="break-all text-xs">
						최종 주소: {item.check.final_url || "확인 불가"} ·{" "}
						{new Date(item.check.checked_at).toLocaleString("ko-KR")}
					</p>
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={!safeUrl}
					onClick={() => {
						recordOpen.mutate({ id: item.id });
						window.open(item.url, "_blank", "noopener,noreferrer");
					}}
				>
					열기
				</Button>
				{item.state === "trash" ? (
					<Button size="sm" disabled={pending} onClick={() => mutate.mutate("restore")}>
						복원
					</Button>
				) : (
					<>
						<Button
							size="sm"
							variant="outline"
							disabled={pending}
							onClick={() => mutate.mutate("keep")}
						>
							유지
						</Button>
						<Button
							size="sm"
							variant="destructive"
							disabled={pending}
							onClick={() => mutate.mutate("trash")}
						>
							휴지통 이동
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={editing}
							onClick={() => {
								setEditVersion(item.version);
								setEditing(true);
							}}
						>
							수정
						</Button>
					</>
				)}
			</div>
			{editing && (
				<form
					className="grid gap-2"
					onChange={() => onDirtyChange(true)}
					onSubmit={(e) => {
						e.preventDefault();
						const data = new FormData(e.currentTarget);
						edit.mutate({
							id: item.id,
							version: editVersion,
							title: String(data.get("title")),
							description: String(data.get("description")),
							note: String(data.get("note")),
							tags: String(data.get("tags"))
								.split(",")
								.map((v) => v.trim())
								.filter(Boolean),
							collectionId: String(data.get("collection")) || null,
						});
					}}
				>
					<label htmlFor={`${fieldId}title`}>
						제목
						<input
							id={`${fieldId}title`}
							className={bookmarkFieldClass}
							name="title"
							defaultValue={item.title}
							maxLength={1000}
						/>
					</label>
					<label htmlFor={`${fieldId}description`}>
						설명
						<textarea
							id={`${fieldId}description`}
							className={bookmarkFieldClass}
							name="description"
							defaultValue={item.description}
							maxLength={4000}
						/>
					</label>
					<div>
						<label htmlFor={`${fieldId}collection`}>컬렉션</label>
						<BookmarkCollectionPicker
							id={`${fieldId}collection`}
							name="collection"
							collections={collections}
							defaultValue={item.collection_id}
							disabled={pending}
						/>
					</div>
					<label htmlFor={`${fieldId}tags`}>
						태그
						<input
							id={`${fieldId}tags`}
							className={bookmarkFieldClass}
							name="tags"
							defaultValue={item.tags.join(", ")}
						/>
					</label>
					<label htmlFor={`${fieldId}note`}>
						메모
						<textarea
							id={`${fieldId}note`}
							className={bookmarkFieldClass}
							name="note"
							defaultValue={item.note}
							maxLength={20000}
						/>
					</label>
					{editVersion !== item.version && (
						<p role="status" className="text-destructive text-xs">
							다른 곳에서 변경된 항목입니다. 입력은 보존되며 저장 시 충돌을 확인합니다.
						</p>
					)}
					<Button type="submit" disabled={edit.isPending}>
						변경 저장
					</Button>
				</form>
			)}
			{mode === "proposal" &&
				item.proposals.map((proposal) => (
					<form
						key={proposal.id}
						className="space-y-2 rounded-md border p-3"
						onChange={() => onDirtyChange(true)}
						onSubmit={(e) => {
							e.preventDefault();
							const data = new FormData(e.currentTarget);
							const newCollectionName = String(data.get("newCollectionName") ?? "").trim();
							apply.mutate({
								items: [
									{
										id: proposal.id,
										collectionId: String(data.get("collectionId") ?? "") || null,
										newCollectionName,
									},
								],
							});
						}}
					>
						<strong className="text-sm">
							{proposal.kind === "classify" ? "AI 컬렉션 제안" : "AI 검토 의견"}
						</strong>
						<p className="text-sm">{proposal.reason}</p>
						{proposal.relevance && (
							<p className="text-xs">관심 주제 관련성: {proposal.relevance}</p>
						)}
						{proposal.kind === "classify" && (
							<>
								<p className="text-xs">
									현재 {collectionPath(item.collection_id, collections)} → 제안{" "}
									{proposal.new_collection_name ||
										collectionPath(proposal.target_collection_id, collections)}
								</p>
								<div className="text-sm">
									<label className="block" htmlFor={`${proposal.id}target`}>
										대상 컬렉션
									</label>
									<select
										id={`${proposal.id}target`}
										className={bookmarkFieldClass}
										name="collectionId"
										defaultValue={proposal.target_collection_id ?? ""}
										onChange={(e) => {
											(
												e.currentTarget.form?.elements.namedItem(
													"newCollectionName"
												) as HTMLInputElement
											).value = "";
										}}
									>
										<option value="">미분류</option>
										{collections.map((c) => (
											<option key={c.id} value={c.id}>
												{collectionPath(c.id, collections)}
											</option>
										))}
									</select>
								</div>
								<label className="block text-sm" htmlFor={`${proposal.id}name`}>
									새 컬렉션 이름 (입력하면 새 컬렉션으로 이동)
									<input
										id={`${proposal.id}name`}
										className={bookmarkFieldClass}
										name="newCollectionName"
										maxLength={160}
										defaultValue={proposal.new_collection_name ?? ""}
									/>
								</label>
							</>
						)}
						{proposalIsStale(item, proposal) && (
							<p className="text-destructive text-xs">
								북마크가 변경되었습니다. 이 제안을 제외하고 다시 분류해주세요.
							</p>
						)}
						<div className="flex gap-2">
							<Button type="submit" size="sm" disabled={pending || proposalIsStale(item, proposal)}>
								{proposal.kind === "classify" ? "이 항목 승인·이동" : "승인·휴지통 이동"}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={pending}
								onClick={() => apply.mutate({ items: [{ id: proposal.id, exclude: true }] })}
							>
								제안 제외
							</Button>
						</div>
					</form>
				))}
			{item.original && (
				<details className="text-muted-foreground text-xs">
					<summary className="cursor-pointer">가져온 원본 정보</summary>
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">
						{JSON.stringify(item.original, null, 2)}
					</pre>
				</details>
			)}
		</div>
	);
}

export type BookmarkDetailSelection = {
	id: string;
	items?: BookmarkItem[];
	mode: "details" | "edit" | "proposal" | "move";
	trigger: HTMLElement | null;
};
export function BookmarkItemDialog({
	selection,
	collections,
	close,
	onDirtyChange,
}: {
	selection: BookmarkDetailSelection | null;
	collections: BookmarkCollection[];
	close: () => void;
	onDirtyChange: (dirty: boolean) => void;
}) {
	const trpc = useTRPCClient();
	const [viewport, setViewport] = useState({ wide: false, tablet: false });
	const trigger = useRef<HTMLElement | null>(null);
	useEffect(() => {
		const wide = window.matchMedia("(min-width:1280px)");
		const tablet = window.matchMedia("(min-width:768px)");
		const update = () => setViewport({ wide: wide.matches, tablet: tablet.matches });
		update();
		wide.addEventListener("change", update);
		tablet.addEventListener("change", update);
		return () => {
			wide.removeEventListener("change", update);
			tablet.removeEventListener("change", update);
		};
	}, []);
	useEffect(() => {
		if (selection) trigger.current = selection.trigger;
	}, [selection]);
	const detail = useQuery({
		queryKey: ["bookmarks", "detail", selection?.id],
		queryFn: () => {
			if (!selection) throw new Error("북마크를 선택해주세요.");
			return trpc.bookmark.detail.query({ id: selection.id });
		},
		enabled: Boolean(selection),
	});
	if (!selection) return null;
	const title = {
		move: "컬렉션 이동",
		proposal: "검토 결과",
		edit: "북마크 수정",
		details: "북마크 상세",
	}[selection.mode];
	const item = detail.data?.items[0];
	function restoreFocus() {
		requestAnimationFrame(() => {
			if (trigger.current?.isConnected) trigger.current.focus();
			else document.getElementById("bookmark-search")?.focus();
		});
	}
	function finish() {
		onDirtyChange(false);
		close();
		restoreFocus();
	}
	function dismiss() {
		close();
		restoreFocus();
	}
	const body = (
		<>
			{detail.isPending ? (
				<div role="status" aria-label="상세를 불러오는 중" className="space-y-3">
					<Skeleton className="h-6 w-2/3" />
					<Skeleton className="h-20 w-full" />
				</div>
			) : item ? (
				selection.mode === "move" ? (
					<BookmarkMoveForm
						key={item.id}
						item={item}
						items={selection.items}
						collections={collections}
						onDone={finish}
					/>
				) : (
					<BookmarkItemDetail
						key={item.id + selection.mode}
						item={item}
						collections={collections}
						mode={selection.mode}
						onDone={finish}
						onDirtyChange={onDirtyChange}
					/>
				)
			) : (
				<div role="alert">
					<p>{detail.error?.message ?? "북마크를 찾을 수 없습니다."}</p>
					<Button variant="outline" onClick={() => detail.refetch()}>
						다시 불러오기
					</Button>
				</div>
			)}
		</>
	);
	if (selection.mode === "move")
		return (
			<AlertDialog
				open
				onOpenChange={(open) => {
					if (!open) dismiss();
				}}
			>
				<AlertDialogContent
					className="max-h-[85dvh] overflow-y-auto"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						restoreFocus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>{title}</AlertDialogTitle>
						<AlertDialogDescription>이동할 컬렉션을 선택하세요.</AlertDialogDescription>
					</AlertDialogHeader>
					{body}
					<Button variant="ghost" onClick={dismiss}>
						닫기
					</Button>
				</AlertDialogContent>
			</AlertDialog>
		);
	if (viewport.wide)
		return (
			<aside
				aria-label={title}
				className={styles.panel}
				onKeyDown={(event) => {
					if (event.key === "Escape" && !(event.target as HTMLElement).closest('[role="tree"]')) {
						event.stopPropagation();
						dismiss();
					}
				}}
			>
				<div className="mb-4 flex items-center justify-between gap-3">
					<h2 className="m-0 border-0 p-0 font-medium text-sm">{title}</h2>
					<Button size="sm" variant="ghost" onClick={dismiss}>
						닫기
					</Button>
				</div>
				{body}
			</aside>
		);
	return (
		<Drawer
			open
			direction={viewport.tablet ? "right" : "bottom"}
			shouldScaleBackground={false}
			onOpenChange={(open) => {
				if (!open) dismiss();
			}}
		>
			<DrawerContent
				className={`${styles.drawer} ${viewport.tablet ? "inset-y-0 right-0 left-auto mt-0 h-full max-h-dvh w-[420px] max-w-full rounded-none" : ""}`}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					restoreFocus();
				}}
			>
				<div className="my-3 flex items-center justify-between">
					<DrawerPrimitive.Title className="m-0 border-0 p-0 font-medium text-base">
						{title}
					</DrawerPrimitive.Title>
					<Button variant="ghost" onClick={dismiss}>
						닫기
					</Button>
				</div>
				<DrawerPrimitive.Description className="sr-only">
					저장 정보와 검토 근거를 확인하고 수정합니다.
				</DrawerPrimitive.Description>
				{body}
			</DrawerContent>
		</Drawer>
	);
}

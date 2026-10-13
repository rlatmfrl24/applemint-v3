"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { BookmarkSaveDialog, bookmarkFieldClass } from "@/components/bookmark-save-dialog";
import { Button } from "@/components/ui/button";
import type {
	BookmarkCollection,
	BookmarkItem,
	BookmarkScope,
	BookmarkSnapshot,
} from "@/contracts/bookmark.schema";
import { collectionPath } from "@/lib/bookmark-collection";
import { latestClassificationProposals } from "@/lib/bookmark-proposal";
import { useTRPCClient } from "@/trpc/client";
import { BookmarkJobs } from "./bookmark-jobs";

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

function BookmarkRow({
	item,
	collections,
	checked,
	onSelect,
}: {
	item: BookmarkItem;
	collections: BookmarkCollection[];
	checked: boolean;
	onSelect: () => void;
}) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const [editing, setEditing] = useState(false);
	const fieldId = useId();
	const mutate = useMutation({
		mutationFn: async (action: "trash" | "restore" | "keep") =>
			trpc.bookmark[action].mutate({ id: item.id, version: item.version }),
		onSuccess: async (_item, action) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
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
			toast.success("변경했습니다.");
		},
		onError: (e) => toast.error(e.message),
	});
	const apply = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmarkProposal.approve.mutate>[0]) =>
			trpc.bookmarkProposal.approve.mutate(input),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
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
		<article className="space-y-3 rounded-lg border bg-card p-4" data-bookmark-id={item.id}>
			<div className="flex items-start gap-3">
				<input
					className="mt-1 size-4"
					type="checkbox"
					aria-label={`${item.title || item.url} 선택`}
					checked={checked}
					onChange={onSelect}
				/>
				<div className="min-w-0 flex-1">
					<h2 className="break-words font-medium">{item.title || item.url}</h2>
					<p className="break-all text-muted-foreground text-xs">{item.url}</p>
					<p className="mt-1 text-xs">
						{collectionPath(item.collection_id, collections)}{" "}
						{item.tags.length > 0 && `· ${item.tags.join(", ")}`}
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
						<Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
							수정
						</Button>
					</>
				)}
			</div>
			{editing && (
				<form
					className="grid gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						const data = new FormData(e.currentTarget);
						edit.mutate({
							id: item.id,
							version: item.version,
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
					<label htmlFor={`${fieldId}collection`}>
						컬렉션
						<select
							id={`${fieldId}collection`}
							className={bookmarkFieldClass}
							name="collection"
							defaultValue={item.collection_id ?? ""}
						>
							<option value="">미분류</option>
							{collections.map((c) => (
								<option key={c.id} value={c.id}>
									{collectionPath(c.id, collections)}
								</option>
							))}
						</select>
					</label>
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
					<Button type="submit" disabled={edit.isPending}>
						변경 저장
					</Button>
				</form>
			)}
			{item.proposals.map((proposal) => (
				<form
					key={proposal.id}
					className="space-y-2 rounded-md border p-3"
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
					{proposal.relevance && <p className="text-xs">관심 주제 관련성: {proposal.relevance}</p>}
					{proposal.kind === "classify" && (
						<>
							<p className="text-xs">
								현재 {collectionPath(item.collection_id, collections)} → 제안{" "}
								{proposal.new_collection_name ||
									collectionPath(proposal.target_collection_id, collections)}
							</p>
							<label className="block text-sm" htmlFor={`${proposal.id}target`}>
								대상 컬렉션
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
							</label>
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
		</article>
	);
}

function BookmarkScopeActions({
	jobScope,
	setJobScope,
	selected,
	job,
}: {
	jobScope: "all" | "collection" | "selected";
	setJobScope: (value: "all" | "collection" | "selected") => void;
	selected: string[];
	job: { isPending: boolean; mutate: (kind: "check" | "classify" | "review") => void };
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<label className="text-sm" htmlFor="job-scope">
				작업 범위
			</label>
			<select
				id="job-scope"
				className="rounded border bg-background p-2 text-sm"
				value={jobScope}
				onChange={(e) => setJobScope(e.target.value as typeof jobScope)}
			>
				<option value="collection">현재 컬렉션 (전체 선택 시 전체)</option>
				<option value="all">전체 라이브러리</option>
				<option value="selected">선택 항목 {selected.length}개</option>
			</select>
			<Button
				variant="outline"
				size="sm"
				disabled={job.isPending || (jobScope === "selected" && selected.length === 0)}
				onClick={() => job.mutate("check")}
			>
				링크 검사
			</Button>
			<Button
				variant="outline"
				size="sm"
				disabled={job.isPending || (jobScope === "selected" && selected.length === 0)}
				onClick={() => job.mutate("classify")}
			>
				AI 컬렉션 분류
			</Button>
			<Button
				variant="outline"
				size="sm"
				disabled={job.isPending || (jobScope === "selected" && selected.length === 0)}
				onClick={() => job.mutate("review")}
			>
				AI 미사용 검토
			</Button>
		</div>
	);
}

function selectedScope(
	jobScope: "all" | "collection" | "selected",
	collection: string,
	selected: string[]
): BookmarkScope {
	if (jobScope === "selected") return { scope: "selected", ids: selected };
	if (jobScope === "all" || collection === "all") return { scope: "all" };
	return { scope: "collection", collectionId: collection || null };
}
function BookmarkBulkControls({
	count,
	tab,
	bulk,
}: {
	count: number;
	tab: "library" | "review" | "trash";
	bulk: { isPending: boolean; mutate: (action: "trash" | "restore" | "keep") => void };
}) {
	return (
		<>
			{" "}
			{count > 0 && (
				<div className="flex flex-wrap gap-2 rounded-md border p-3">
					<span className="text-sm">선택 {count}개</span>
					<Button
						variant="destructive"
						size="sm"
						disabled={bulk.isPending}
						onClick={() => bulk.mutate(tab === "trash" ? "restore" : "trash")}
					>
						{tab === "trash" ? "선택 항목 복원" : "선택 항목 휴지통 이동"}
					</Button>
					{tab === "review" && (
						<Button
							size="sm"
							variant="outline"
							disabled={bulk.isPending}
							onClick={() => bulk.mutate("keep")}
						>
							선택 항목 유지
						</Button>
					)}
				</div>
			)}
		</>
	);
}
function BookmarkResults({
	data,
	isPending,
	error,
	selected,
	onSelect,
}: {
	data: BookmarkSnapshot | undefined;
	isPending: boolean;
	error: Error | null;
	selected: string[];
	onSelect: (id: string) => void;
}) {
	const collections = data?.collections ?? [];
	return (
		<>
			{isPending && <p role="status">북마크를 불러오는 중…</p>}
			{error && (
				<p role="alert" className="text-destructive">
					{error.message}
				</p>
			)}
			{data?.items.length === 0 && (
				<p className="rounded-lg border p-8 text-center text-muted-foreground">
					표시할 북마크가 없습니다.
				</p>
			)}
			{data?.items.map((item) => (
				<BookmarkRow
					key={item.id}
					item={item}
					collections={collections}
					checked={selected.includes(item.id)}
					onSelect={() => onSelect(item.id)}
				/>
			))}
		</>
	);
}
function BookmarkProposalBulk({ items, clear }: { items: BookmarkItem[]; clear: () => void }) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const proposals = items.flatMap((item) =>
		item.proposals.map((proposal) => ({ proposal, stale: proposalIsStale(item, proposal) }))
	);
	const classifications = latestClassificationProposals(items);
	const approve = useMutation({
		mutationFn: (exclude: boolean) =>
			trpc.bookmarkProposal.approve.mutate({
				items: (exclude ? proposals.map(({ proposal }) => proposal) : classifications).map(
					(proposal) => ({
						id: proposal.id,
						exclude,
					})
				),
			}),
		onSuccess: async () => {
			clear();
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("선택 제안을 처리했습니다.");
		},
		onError: (error) => toast.error(error.message),
	});
	if (proposals.length === 0) return null;
	return (
		<div className="space-y-2 rounded-md border p-3 text-sm">
			<p>
				각 북마크의 최신 유효 AI 컬렉션 원안을 일괄 처리합니다. 수정한 이름·대상은 각 항목의 승인
				버튼으로 적용하세요.
			</p>
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					disabled={approve.isPending || classifications.length === 0}
					onClick={() => approve.mutate(false)}
				>
					선택 AI 컬렉션 원안 승인 {classifications.length}개
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={approve.isPending}
					onClick={() => approve.mutate(true)}
				>
					선택 AI 제안 제외 {proposals.length}개
				</Button>
			</div>
		</div>
	);
}
export function BookmarkLibrary() {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const params = useSearchParams();
	const [tab, setTab] = useState<"library" | "review" | "trash">(
		params.get("state") === "trash" ? "trash" : "library"
	);
	const [collection, setCollection] = useState("all");
	const [search, setSearch] = useState(params.get("search") ?? "");
	const [offset, setOffset] = useState(0);
	const [selected, setSelected] = useState<string[]>([]);
	const [jobScope, setJobScope] = useState<"all" | "collection" | "selected">("collection");
	const filter = {
		state: tab === "trash" ? ("trash" as const) : ("library" as const),
		review: tab === "review",
		search,
		offset,
		limit: 50,
		...(collection === "all" ? {} : { collectionId: collection || null }),
	};
	const query = useQuery({
		queryKey: ["bookmarks", "list", filter],
		queryFn: () => trpc.bookmark.list.query(filter),
		refetchInterval: 5000,
	});
	const job = useMutation({
		mutationFn: async (kind: "check" | "classify" | "review") => {
			const scope = selectedScope(jobScope, collection, selected);
			return kind === "check"
				? trpc.bookmarkCheck.start.mutate(scope)
				: trpc.bookmarkAI[kind].mutate(scope);
		},
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("작업을 등록했습니다. 브라우저를 닫아도 작업 상태가 유지됩니다.");
		},
		onError: (e) => toast.error(e.message),
	});
	const createCollection = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmarkCollection.create.mutate>[0]) =>
			trpc.bookmarkCollection.create.mutate(input),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("컬렉션을 만들었습니다.");
		},
		onError: (e) => toast.error(e.message),
	});
	const bulk = useMutation({
		mutationFn: (action: "trash" | "restore" | "keep") =>
			trpc.bookmark.bulk.mutate({
				action,
				items: (query.data?.items ?? [])
					.filter((i) => selected.includes(i.id))
					.map((i) => ({ id: i.id, version: i.version })),
			}),
		onSuccess: async () => {
			setSelected([]);
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("선택 항목을 처리했습니다.");
		},
		onError: (e) => toast.error(e.message),
	});
	const renameCollection = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmarkCollection.rename.mutate>[0]) =>
			trpc.bookmarkCollection.rename.mutate(input),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
		},
		onError: (e) => toast.error(e.message),
	});
	const collections = query.data ? query.data.collections : [];
	const currentCollection = collections.find((c) => c.id === collection);
	function resetView() {
		setOffset(0);
		setSelected([]);
	}
	return (
		<div className="mx-auto w-full max-w-6xl space-y-5 p-4">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="font-semibold text-2xl">북마크</h1>
					<p className="text-muted-foreground text-sm">
						Applemint에 저장하고 검토한 항목을 정리합니다.
					</p>
				</div>
				<div className="flex items-center gap-3">
					<BookmarkSaveDialog />
					<a className="text-sm underline" href="/main/setting/bookmarks">
						북마크 설정
					</a>
				</div>
			</header>
			<nav aria-label="북마크 보기" className="flex gap-2">
				{(["library", "review", "trash"] as const).map((t) => (
					<Button
						key={t}
						variant={tab === t ? "secondary" : "ghost"}
						aria-pressed={tab === t}
						onClick={() => {
							setTab(t);
							resetView();
						}}
					>
						{{ library: "라이브러리", review: "검토", trash: "휴지통" }[t]}
					</Button>
				))}
			</nav>
			{tab === "review" && (
				<p className="rounded-md bg-muted p-3 text-sm">
					오래됨(180일)·중복·검사 결과·AI 의견을 근거로 검토합니다. 사용 이력이 없다는 사실만으로
					미사용을 확정하지 않습니다. ‘유지’하면 같은 검토 후보를 다시 표시하지 않습니다.
				</p>
			)}
			<div className="grid gap-5 md:grid-cols-[220px_1fr]">
				<aside className="space-y-3">
					<nav
						className="max-h-[60dvh] overflow-y-auto rounded-md border p-2"
						aria-label="북마크 컬렉션"
					>
						{[
							{ id: "all", name: "전체 라이브러리" },
							{ id: "", name: "미분류" },
							...collections.map((c) => ({ id: c.id, name: collectionPath(c.id, collections) })),
						].map((c) => (
							<button
								type="button"
								key={c.id}
								className={`block min-h-10 w-full rounded px-2 py-2 text-left text-sm ${collection === c.id ? "bg-muted font-medium" : "hover:bg-muted"}`}
								onClick={() => {
									setCollection(c.id);
									resetView();
								}}
							>
								{c.name}
							</button>
						))}
					</nav>
					<form
						className="space-y-2"
						onSubmit={(e) => {
							e.preventDefault();
							const data = new FormData(e.currentTarget);
							createCollection.mutate({
								name: String(data.get("name")),
								parentId: currentCollection?.id ?? null,
							});
							e.currentTarget.reset();
						}}
					>
						<label className="block text-sm" htmlFor="new-collection">
							새 컬렉션 {currentCollection && `(${currentCollection.name} 아래)`}
						</label>
						<input
							className={bookmarkFieldClass}
							id="new-collection"
							name="name"
							required
							maxLength={160}
						/>
						<Button type="submit" variant="outline" size="sm" disabled={createCollection.isPending}>
							컬렉션 생성
						</Button>
					</form>
					{currentCollection && (
						<form
							className="space-y-2"
							key={currentCollection.id}
							onSubmit={(e) => {
								e.preventDefault();
								renameCollection.mutate({
									id: currentCollection.id,
									version: currentCollection.version,
									name: String(new FormData(e.currentTarget).get("name")),
								});
							}}
						>
							<label className="text-sm" htmlFor="rename-collection">
								현재 컬렉션 이름
							</label>
							<input
								id="rename-collection"
								className={bookmarkFieldClass}
								name="name"
								required
								maxLength={160}
								defaultValue={currentCollection.name}
							/>
							<Button size="sm" variant="outline" disabled={renameCollection.isPending}>
								이름 변경
							</Button>
						</form>
					)}
				</aside>
				<main className="min-w-0 space-y-4">
					<BookmarkBulkControls count={selected.length} tab={tab} bulk={bulk} />
					<BookmarkProposalBulk
						items={query.data?.items.filter((item) => selected.includes(item.id)) ?? []}
						clear={() => setSelected([])}
					/>
					<label className="block" htmlFor="bookmark-search">
						<span className="sr-only">북마크 검색</span>
						<input
							id="bookmark-search"
							className={bookmarkFieldClass}
							placeholder="제목 또는 URL 검색"
							value={search}
							onChange={(e) => {
								setSearch(e.target.value);
								resetView();
							}}
						/>
					</label>
					{tab !== "trash" && (
						<BookmarkScopeActions
							jobScope={jobScope}
							setJobScope={setJobScope}
							selected={selected}
							job={job}
						/>
					)}
					<div className="flex items-center justify-between text-sm">
						<span>
							{query.data?.total.toLocaleString() ?? "…"}개 · 선택 {selected.length}개
						</span>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setSelected(query.data?.items.map((i) => i.id) ?? [])}
						>
							현재 페이지 선택
						</Button>
					</div>
					<BookmarkResults
						data={query.data}
						isPending={query.isPending}
						error={query.error}
						selected={selected}
						onSelect={(id) =>
							setSelected((ids) =>
								ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
							)
						}
					/>
					<div className="flex justify-between">
						<Button
							variant="outline"
							disabled={offset === 0}
							onClick={() => {
								setOffset(Math.max(0, offset - 50));
								setSelected([]);
							}}
						>
							이전
						</Button>
						<span className="text-sm">{Math.floor(offset / 50) + 1}페이지</span>
						<Button
							variant="outline"
							disabled={offset + 50 >= (query.data?.total ?? 0)}
							onClick={() => {
								setOffset(offset + 50);
								setSelected([]);
							}}
						>
							다음
						</Button>
					</div>
				</main>
			</div>
			<details className="rounded-lg border p-3">
				<summary className="cursor-pointer font-medium">최근 작업 상태</summary>
				<div className="mt-3">
					<BookmarkJobs jobs={query.data?.jobs ?? []} />
				</div>
			</details>
			<p className="text-muted-foreground text-xs">
				열기 기록은 버튼 사용 기록이며 외부 페이지 방문 완료나 완독의 증거가 아닙니다. 영구 삭제와
				정기 자동 검사는 수행하지 않습니다.
			</p>
		</div>
	);
}

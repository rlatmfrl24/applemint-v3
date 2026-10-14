"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { BookmarkRecommendationStatus } from "@/contracts/bookmark.schema";
import { collectionForHost } from "@/lib/bookmark-host";
import { useTRPCClient } from "@/trpc/client";
import { BookmarkCollectionPicker, bookmarkFieldClass } from "./bookmark-collection-picker";

export type Source = { id: string; url: string; title: string };
function recommendationIsFresh(
	data: BookmarkRecommendationStatus | undefined,
	source: Source,
	title: string
) {
	return (
		data?.job.scope.threadId === source.id &&
		data.job.scope.title === title.trim() &&
		data.job.scope.url === source.url
	);
}
function recommendationIsPending(data: BookmarkRecommendationStatus | undefined) {
	return !data || ["queued", "processing", "retry"].includes(data.job.state);
}
function RecommendationFeedback({
	message,
	configured,
	hostMatched,
	canRefetch,
	refetch,
}: {
	message?: string | null;
	configured?: boolean;
	hostMatched: boolean;
	canRefetch: boolean;
	refetch: () => void;
}) {
	if (message)
		return (
			<div role="alert" className="text-destructive text-sm">
				<p>{message}</p>
				{canRefetch && (
					<Button type="button" variant="ghost" size="sm" onClick={refetch}>
						추천 결과 다시 확인
					</Button>
				)}
			</div>
		);
	return configured === false && !hostMatched ? (
		<p className="text-muted-foreground text-xs">
			추천 설정이 필요합니다. 수동 선택과 저장은 가능합니다.
		</p>
	) : null;
}
export default function BookmarkSaveForm({
	source,
	close,
	recommendationId,
	returnFocus,
}: {
	source: Source;
	close: () => void;
	recommendationId?: string;
	returnFocus: () => void;
}) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const fieldId = useId();
	const titleInput = useRef<HTMLInputElement>(null);
	const [title, setTitle] = useState(source.title);
	const [selection, setSelection] = useState<{ id: string | null; version?: number }>();
	const [appliedRecommendation, setAppliedRecommendation] = useState<string | undefined>();
	const [jobId, setJobId] = useState(recommendationId);
	const [applying, setApplying] = useState(false);
	const handledJob = useRef<string | undefined>(undefined);
	const draftRevision = useRef(0);
	const requestRevision = useRef(0);
	const collections = useQuery({
		queryKey: ["bookmarks", "collections"],
		queryFn: () => trpc.bookmarkCollection.list.query(),
	});
	const config = useQuery({
		queryKey: ["bookmarks", "configuration"],
		queryFn: () => trpc.bookmarkImport.configuration.query(),
	});
	const hostMatch = collectionForHost(source.url, collections.data ?? []);
	const chosen = selection ?? { id: hostMatch?.id ?? null, version: hostMatch?.version };
	const recommend = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmarkAI.recommend.mutate>[0]) =>
			trpc.bookmarkAI.recommend.mutate(input),
		onSuccess: (job) => setJobId(job.id),
	});
	const recommendation = useQuery({
		queryKey: ["bookmarks", "recommendation", jobId],
		queryFn: () => {
			if (!jobId) throw new Error("추천 작업을 먼저 등록해주세요.");
			return trpc.bookmarkAI.recommendation.query({ id: jobId });
		},
		enabled: Boolean(jobId),
		retry: false,
		refetchInterval: (q) =>
			q.state.data && ["queued", "processing", "retry"].includes(q.state.data.job.state)
				? 1000
				: false,
	});
	const result =
		recommendation.data?.job.state === "succeeded" ? recommendation.data.recommendation : null;
	const fresh = recommendationIsFresh(recommendation.data, source, title);
	const busy =
		recommend.isPending ||
		(Boolean(jobId) && !recommendation.error && recommendationIsPending(recommendation.data));
	const message =
		recommend.error?.message ?? recommendation.error?.message ?? recommendation.data?.job.error;
	async function requestRecommendation() {
		requestRevision.current = draftRevision.current;
		setJobId(undefined);
		setApplying(true);
		try {
			const current = await collections.refetch();
			if (current.error) throw current.error;
			if (!current.data) throw new Error("컬렉션을 불러오지 못했습니다. 다시 추천받아주세요.");
			const match = collectionForHost(source.url, current.data);
			if (match) {
				setSelection({ id: match.id, version: match.version });
				setAppliedRecommendation(undefined);
				toast.success("호스트와 일치하는 컬렉션을 선택했습니다.");
				return;
			}
			recommend.mutate({ threadId: source.id, title, requestId: crypto.randomUUID() });
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "추천을 요청하지 못했습니다.");
		} finally {
			setApplying(false);
		}
	}
	const save = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmark.save.mutate>[0]) =>
			trpc.bookmark.save.mutate(input),
		onSuccess: async (result) => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			close();
			toast.success(
				result.existing
					? result.item.state === "trash"
						? "휴지통에 이미 저장한 URL입니다. 복원할 수 있습니다."
						: "이미 저장한 URL입니다. 기존 북마크를 확인해주세요."
					: "북마크를 저장했습니다.",
				{
					action: {
						label: "북마크 보기",
						onClick: () => {
							window.location.href = `/main/bookmarks?state=${result.item.state}&search=${encodeURIComponent(result.item.url)}`;
						},
					},
				}
			);
		},
		onError: async (error) => {
			await collections.refetch();
			setAppliedRecommendation(undefined);
			toast.error(error.message);
		},
	});
	const locked = applying || save.isPending;
	const recommending = busy || applying;
	useEffect(() => {
		if (!jobId || !result || handledJob.current === jobId || save.isPending) return;
		if (!fresh || requestRevision.current !== draftRevision.current) {
			handledJob.current = jobId;
			setApplying(false);
			toast.info("입력을 변경해 이전 추천을 적용하지 않았습니다. 필요하면 다시 추천받아주세요.");
			return;
		}
		let active = true;
		setApplying(true);
		void collections
			.refetch()
			.then((current) => {
				if (!active) return;
				if (current.error) throw current.error;
				const target = current.data?.find((c) => c.id === result.collectionId);
				if (result.collectionId && target?.version !== result.collectionVersion)
					throw new Error("추천 컬렉션이 변경되었습니다. 다시 추천받거나 트리에서 선택해주세요.");
				setSelection({ id: result.collectionId, version: result.collectionVersion ?? undefined });
				setAppliedRecommendation(jobId);
				toast.success("추천 컬렉션을 선택했습니다.");
			})
			.catch((error: unknown) => {
				if (active)
					toast.error(error instanceof Error ? error.message : "추천을 적용하지 못했습니다.");
			})
			.finally(() => {
				if (active) {
					handledJob.current = jobId;
					setApplying(false);
				}
			});
		return () => {
			active = false;
		};
	}, [jobId, result, fresh, collections.refetch, save.isPending]);
	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<AlertDialogContent
				className="max-h-[90dvh] overflow-y-auto"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					titleInput.current?.focus();
				}}
				onEscapeKeyDown={(event) => {
					if ((event.target as HTMLElement).closest('[role="tree"]')) event.preventDefault();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					returnFocus();
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>북마크 저장</AlertDialogTitle>
					<AlertDialogDescription>
						컬렉션을 확인한 뒤 저장하세요. 추천받기를 누르면 선택에 반영됩니다. 수집 글 상태는
						유지됩니다.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						const data = new FormData(event.currentTarget);
						save.mutate({
							url: source.url,
							title,
							collectionId: chosen.id,
							collectionVersion: chosen.version,
							recommendationId: appliedRecommendation,
							tags: String(data.get("tags"))
								.split(",")
								.map((s) => s.trim())
								.filter(Boolean),
							note: String(data.get("note")),
							threadId: source.id,
						});
					}}
				>
					<label className="block space-y-1" htmlFor={`${fieldId}url`}>
						<span>URL</span>
						<input
							className={bookmarkFieldClass}
							id={`${fieldId}url`}
							type="url"
							value={source.url}
							readOnly
						/>
					</label>
					<label className="block space-y-1" htmlFor={`${fieldId}title`}>
						<span>제목 (선택)</span>
						<input
							className={bookmarkFieldClass}
							id={`${fieldId}title`}
							ref={titleInput}
							name="title"
							maxLength={1000}
							value={title}
							disabled={locked}
							onChange={(event) => {
								draftRevision.current++;
								setTitle(event.target.value);
								setAppliedRecommendation(undefined);
							}}
						/>
					</label>
					<div className="flex items-center justify-between gap-2">
						<label htmlFor={`${fieldId}collection`}>컬렉션</label>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={recommending || save.isPending || (!hostMatch && !config.data?.openrouter)}
							onClick={requestRecommendation}
						>
							{recommending ? "추천 중…" : "추천받기"}
						</Button>
					</div>
					<BookmarkCollectionPicker
						id={`${fieldId}collection`}
						name="collection"
						defaultValue={null}
						value={chosen.id}
						collections={collections.data ?? []}
						disabled={locked}
						onChange={(id) => {
							draftRevision.current++;
							setSelection({ id, version: collections.data?.find((c) => c.id === id)?.version });
							setAppliedRecommendation(undefined);
						}}
					/>
					{collections.error && (
						<p role="alert" className="text-destructive text-xs">
							컬렉션을 불러오지 못했습니다. 미분류로 저장할 수 있습니다.
						</p>
					)}
					<RecommendationFeedback
						message={message}
						configured={config.data?.openrouter}
						hostMatched={Boolean(hostMatch)}
						canRefetch={Boolean(recommendation.error)}
						refetch={() => {
							void recommendation.refetch();
						}}
					/>
					<label className="block space-y-1" htmlFor={`${fieldId}tags`}>
						<span>태그 (쉼표로 구분)</span>
						<input className={bookmarkFieldClass} id={`${fieldId}tags`} name="tags" />
					</label>
					<label className="block space-y-1" htmlFor={`${fieldId}note`}>
						<span>메모</span>
						<textarea
							className={bookmarkFieldClass}
							id={`${fieldId}note`}
							name="note"
							maxLength={20000}
							rows={3}
						/>
					</label>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" type="button" disabled={save.isPending} onClick={close}>
							취소
						</Button>
						<Button type="submit" disabled={locked}>
							{save.isPending ? "저장 중…" : "저장"}
						</Button>
					</div>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}

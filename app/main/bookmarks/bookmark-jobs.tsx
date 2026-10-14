"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { BookmarkSaveDialog } from "@/components/bookmark-save-dialog";
import { Button } from "@/components/ui/button";
import type { BookmarkJob } from "@/contracts/bookmark.schema";
import { useTRPCClient } from "@/trpc/client";

const kindLabels: Record<BookmarkJob["kind"], string> = {
	metadata: "제목·설명 수집",
	import: "Raindrop 이관",
	check: "링크 검사",
	classify: "AI 컬렉션 분류",
	interests: "AI 관심 주제",
	review: "AI 미사용 검토",
	recommend: "저장 컬렉션 추천",
};
const stateLabels: Record<BookmarkJob["state"], string> = {
	queued: "대기",
	processing: "처리 중",
	retry: "다음 처리 대기",
	paused: "사용자 재개 대기",
	failed: "실패",
	partial: "일부 미완료",
	succeeded: "완료",
};
function JobItems({ id }: { id: string }) {
	const trpc = useTRPCClient();
	const [open, setOpen] = useState(false);
	const [offset, setOffset] = useState(0);
	const query = useQuery({
		queryKey: ["bookmarks", "job-items", id, offset],
		queryFn: () => trpc.bookmarkImport.details.query({ id, offset }),
		enabled: open,
		refetchInterval: open ? 10000 : false,
	});
	return (
		<details className="mt-2" onToggle={(e) => setOpen(e.currentTarget.open)}>
			<summary className="cursor-pointer">실패·재검사·미처리 항목 확인</summary>
			{query.error && <p role="alert">{query.error.message}</p>}
			{query.data?.items.map((item) => (
				<p className="mt-2" key={item.bookmark_id}>
					<a
						className="underline"
						href={`/main/bookmarks?search=${encodeURIComponent(item.bookmarks.url)}`}
					>
						{item.bookmarks.title || item.bookmarks.url}
					</a>{" "}
					·{" "}
					{item.error ||
						{ pending: "미처리", waiting: "1분 뒤 재검사 대기", failed: "실패" }[item.state]}
				</p>
			))}
			{query.data?.total === 0 && <p>남은 미처리·실패 항목이 없습니다.</p>}
			<div className="mt-2 flex gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={offset === 0}
					onClick={() => setOffset(Math.max(0, offset - 50))}
				>
					이전 항목
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={offset + 50 >= (query.data?.total ?? 0)}
					onClick={() => setOffset(offset + 50)}
				>
					다음 항목
				</Button>
			</div>
		</details>
	);
}
export function BookmarkJobs({ jobs }: { jobs: BookmarkJob[] }) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const resume = useMutation({
		mutationFn: (input: Parameters<typeof trpc.bookmarkImport.resume.mutate>[0]) =>
			trpc.bookmarkImport.resume.mutate(input),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("같은 작업을 재개했습니다.");
		},
		onError: (e) => toast.error(e.message),
	});
	return (
		<div className="space-y-2">
			{jobs.length === 0 ? (
				<p className="text-muted-foreground text-sm">등록한 작업이 없습니다.</p>
			) : (
				jobs.map((job) => (
					<article
						key={job.id}
						data-bookmark-job-id={job.id}
						className="rounded-md border p-3 text-sm"
					>
						{job.kind !== "import" && job.kind !== "recommend" && <JobItems id={job.id} />}
						{job.progress.usageUncertain === true && (
							<p>사용량 확인 불가 · 예약액 유지 · 생성된 제안은 보존됩니다.</p>
						)}
						<div className="flex flex-wrap items-center justify-between gap-2">
							<strong>{kindLabels[job.kind]}</strong>
							<span>
								{stateLabels[job.state]} · {job.completed.toLocaleString()}/
								{job.total.toLocaleString()} · 실패 {job.failed}
							</span>
						</div>
						{job.kind === "import" && (
							<p className="mt-1 text-muted-foreground">
								조회 {String(job.progress.readCount ?? 0)} · 저장{" "}
								{String(job.progress.storedCount ?? job.completed)} · 페이지{" "}
								{String(job.progress.page ?? 0)} · 검증{" "}
								{job.progress.verified === true ? "일치" : "미완료"}
							</p>
						)}
						{job.error && (
							<p role="status" className="mt-2 text-destructive">
								{job.error}
							</p>
						)}
						{job.kind === "recommend" &&
							typeof job.scope.threadId === "string" &&
							typeof job.scope.url === "string" &&
							typeof job.scope.title === "string" && (
								<div className="mt-2">
									<p className="mb-2 break-words text-muted-foreground">
										{job.scope.title || job.scope.url}
									</p>
									<BookmarkSaveDialog
										source={{ id: job.scope.threadId, url: job.scope.url, title: job.scope.title }}
										recommendationId={job.id}
									/>
								</div>
							)}
						{Array.isArray(job.progress.failedIds) && job.progress.failedIds.length > 0 && (
							<p>실패 원본 ID: {job.progress.failedIds.join(", ")}</p>
						)}
						{["failed", "partial", "paused"].includes(job.state) && (
							<Button
								className="mt-2"
								size="sm"
								variant="outline"
								disabled={resume.isPending}
								onClick={() => resume.mutate({ id: job.id })}
							>
								같은 작업 재개
							</Button>
						)}
					</article>
				))
			)}
		</div>
	);
}

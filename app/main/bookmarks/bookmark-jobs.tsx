"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { BookmarkSaveDialog } from "@/components/bookmark-save-dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
const phaseLabels = {
	page: "원문 확인",
	media: "미디어 확인",
	decision: "AI 판정",
	confirm: "의심 재확인",
	done: "관측 완료",
};
const waitingLabels = {
	host: "호스트 요청 간격·접근 제한 대기",
	ai_budget: "AI 예산 대기",
	confirmation: "의심 재확인 대기",
	retry: "다음 처리 대기",
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

function isScheduled(job: BookmarkJob) {
	return job.kind === "classify" && job.scope.origin === "scheduled-classify";
}

function jobStateLabel(job: BookmarkJob) {
	return isScheduled(job) && job.progress.closedAt ? "종료됨" : stateLabels[job.state];
}

function ScheduledClose({ id }: { id: string }) {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const close = useMutation({
		mutationFn: () => trpc.bookmarkAI.closeScheduledJob.mutate({ id, confirmed: true }),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: ["bookmarks"] });
			toast.success("회차를 종료했습니다.");
		},
		onError: (error) => toast.error(error.message),
	});
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button size="sm" variant="outline" disabled={close.isPending}>
					회차 종료
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogTitle>이 회차를 종료할까요?</AlertDialogTitle>
				<AlertDialogDescription>
					완료 결과와 제안, 비용 기록은 보존됩니다. 이 회차의 남은 항목은 마감하며, 다음 KST
					날짜부터 다른 후보를 처리합니다.
				</AlertDialogDescription>
				<AlertDialogFooter>
					<AlertDialogCancel>취소</AlertDialogCancel>
					<AlertDialogAction onClick={() => close.mutate()}>종료 확인</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function JobActions({
	job,
	onResume,
	resuming,
}: {
	job: BookmarkJob;
	onResume: () => void;
	resuming: boolean;
}) {
	const scheduled = isScheduled(job);
	const resumable = ["failed", "partial", "paused"].includes(job.state);
	if (!resumable) return null;
	if (
		scheduled &&
		(job.progress.closedAt ||
			(job.lease_expires_at && Date.parse(job.lease_expires_at) > Date.now()))
	)
		return null;
	return (
		<div className="mt-2 space-y-2">
			{scheduled && job.progress.usageUncertain === true && (
				<p className="text-muted-foreground">
					확인되지 않은 예약액은 유지되며, 재개하면 미처리 항목에 대한 AI 요청이 재호출될 수
					있습니다.
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" disabled={resuming} onClick={onResume}>
					같은 작업 재개
				</Button>
				{scheduled && <ScheduledClose id={job.id} />}
			</div>
		</div>
	);
}

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
			<summary className="focus-visible:outline-ring min-h-11 cursor-pointer rounded-md py-2 focus-visible:outline">
				실패·재검사·미처리 항목 확인
			</summary>
			{open && query.isPending && (
				<p role="status" aria-busy="true">
					작업 항목을 불러오는 중…
				</p>
			)}
			{query.error && (
				<div role="alert">
					<p>{query.error.message}</p>
					<Button size="sm" variant="outline" onClick={() => query.refetch()}>
						작업 항목 다시 불러오기
					</Button>
				</div>
			)}
			{query.data?.items.map((item) => (
				<p className="mt-2" key={item.bookmark_id}>
					<Link
						className="underline"
						href={`/main/bookmarks?search=${encodeURIComponent(item.bookmarks.url)}`}
					>
						{item.bookmarks.title || item.bookmarks.url}
					</Link>{" "}
					·{" "}
					{item.error ||
						(item.waitingReason
							? waitingLabels[item.waitingReason]
							: { pending: "미처리", waiting: "다음 처리 대기", failed: "실패" }[item.state])}
					{item.phase && ` · ${phaseLabels[item.phase]}`}
					{item.state === "waiting" &&
						` · ${new Date(item.available_at).toLocaleString("ko-KR")} 이후`}
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
						id={`bookmark-job-${job.id}`}
						data-bookmark-job-id={job.id}
						className="rounded-md border p-3 text-sm"
					>
						{job.kind !== "import" && job.kind !== "recommend" && <JobItems id={job.id} />}
						{job.progress.usageUncertain === true && (
							<p>사용량 확인 불가 · 예약액 유지 · 생성된 제안은 보존됩니다.</p>
						)}
						<div className="flex flex-wrap items-center justify-between gap-2">
							<JobHeading job={job} />
							<span>
								{jobStateLabel(job)} · {job.completed.toLocaleString()}/{job.total.toLocaleString()}{" "}
								· 실패 {job.failed}
							</span>
						</div>

						{job.kind === "import" && (
							<p className="text-muted-foreground mt-1">
								조회 {String(job.progress.readCount ?? 0)} · 저장{" "}
								{String(job.progress.storedCount ?? job.completed)} · 페이지{" "}
								{String(job.progress.page ?? 0)} · 검증{" "}
								{job.progress.verified === true ? "일치" : "미완료"}
							</p>
						)}
						{job.error && (
							<p role="status" className="text-destructive mt-2">
								{job.error}
							</p>
						)}
						{job.kind === "recommend" &&
							typeof job.scope.threadId === "string" &&
							typeof job.scope.url === "string" &&
							typeof job.scope.title === "string" && (
								<div className="mt-2">
									<p className="text-muted-foreground mb-2 break-words">
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
						<JobActions
							job={job}
							resuming={resume.isPending}
							onResume={() => resume.mutate({ id: job.id })}
						/>
					</article>
				))
			)}
		</div>
	);
}

function JobHeading({ job }: { job: BookmarkJob }) {
	if (isScheduled(job))
		return (
			<div>
				<strong>정기 재분류 · {String(job.scope.scheduledDate)}</strong>
				<Link className="ml-2 text-xs underline" href="/main/bookmarks/review?group=classify">
					컬렉션 제안
				</Link>
			</div>
		);
	return (
		<div>
			<strong>
				{kindLabels[job.kind]}
				{job.kind === "check" && ` · ${job.scope.origin === "automatic" ? "자동" : "수동"}`}
			</strong>
			{job.kind === "check" && (
				<p className="text-muted-foreground mt-1">
					판단 불가 {Number(job.progress.unknownCount ?? 0)}개 · AI 대기{" "}
					{Number(job.progress.aiPendingCount ?? 0)}개 · 완료는 정상 링크 비율이 아닌 검사 진행
					상태입니다.
				</p>
			)}
		</div>
	);
}

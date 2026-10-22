"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bookmark, CheckCircle2, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { BookmarkJobs } from "@/app/main/bookmarks/bookmark-jobs";
import { Button } from "@/components/ui/button";
import type { BookmarkJob } from "@/contracts/bookmark.schema";
import { useTRPCClient } from "@/trpc/client";
import { SettingsPageHeader, SettingsSurface } from "../admin-ui";
import { BookmarkAIUsagePanel } from "./bookmark-ai-usage";
import { BookmarkHealthSettingsPanel } from "./bookmark-health-settings";
import { BookmarkInterestEditor } from "./bookmark-interest-editor";

function ImportSettings({
	job,
	configured,
	refresh,
}: {
	job?: BookmarkJob;
	configured: boolean;
	refresh: () => Promise<void>;
}) {
	const trpc = useTRPCClient();
	const [confirmed, setConfirmed] = useState(false);
	const start = useMutation({
		mutationFn: () => trpc.bookmarkImport.start.mutate({ confirmed: true }),
		onSuccess: refresh,
		onError: (error) => toast.error(error.message),
	});
	const complete = job?.state === "succeeded";
	return (
		<details className="group rounded-xl border bg-card" open={complete ? undefined : true}>
			<summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-4 text-sm focus-visible:outline focus-visible:outline-ring sm:px-5">
				<span className="font-medium">Raindrop 가져오기</span>
				<span className="flex items-center gap-3 text-muted-foreground text-xs">
					<span>{complete ? `완료 · ${job.completed.toLocaleString()}개` : "최초 한 번"}</span>
					<ChevronDown
						aria-hidden="true"
						className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
					/>
				</span>
			</summary>
			<div className="space-y-3 border-t p-4 text-sm sm:p-5">
				<p className="max-w-prose text-muted-foreground text-xs leading-5">
					최상위·하위·빈 컬렉션과 미분류를 포함합니다. Raindrop 휴지통은 제외하고 후속 동기화는 하지
					않습니다.
				</p>
				<p className="max-w-prose text-xs leading-5">
					이관 전에 백업과 API 이용 조건을 확인하세요. 완료할 때까지 Raindrop 자료를 수정하지 않는
					것이 좋습니다.
				</p>
				<a
					className="text-xs underline underline-offset-4"
					href="https://developer.raindrop.io/terms"
					target="_blank"
					rel="noreferrer"
				>
					Raindrop API 이용 조건
				</a>
				<p className="text-xs">
					서버 이관 토큰: {configured ? "설정됨" : "RAINDROP_IMPORT_TOKEN 설정 필요"}
				</p>
				{complete ? (
					<p role="status" className="text-xs">
						이관 완료 · 새 이관은 비활성화되었습니다. 서버에서 임시 RAINDROP_IMPORT_TOKEN을
						제거해주세요.
					</p>
				) : (
					<>
						<label className="flex items-start gap-2 text-xs">
							<input
								type="checkbox"
								checked={confirmed}
								onChange={(event) => setConfirmed(event.target.checked)}
								className="mt-0.5"
							/>
							<span>백업을 준비했고, 가져오기 범위와 API 이용 조건을 확인했습니다.</span>
						</label>
						<Button
							size="sm"
							disabled={
								!confirmed ||
								!configured ||
								start.isPending ||
								(job !== undefined && !["failed", "partial", "paused"].includes(job.state))
							}
							onClick={() => start.mutate()}
						>
							{job ? "기존 이관 작업 재개" : "최초 가져오기 시작"}
						</Button>
					</>
				)}
				{job && <BookmarkJobs jobs={[job]} />}
			</div>
		</details>
	);
}

export default function BookmarkSettingsPage() {
	const trpc = useTRPCClient();
	const cache = useQueryClient();
	const data = useQuery({
		queryKey: ["bookmarks", "settings"],
		queryFn: () =>
			trpc.bookmark.list.query({ state: "library", offset: 0, limit: 1, review: false }),
		refetchInterval: 5000,
	});
	const config = useQuery({
		queryKey: ["bookmarks", "configuration"],
		queryFn: () => trpc.bookmarkImport.configuration.query(),
	});
	const refresh = async () => {
		await cache.invalidateQueries({ queryKey: ["bookmarks"] }, { throwOnError: true });
	};
	const suggest = useMutation({
		mutationFn: () => trpc.bookmarkAI.suggestInterests.mutate(),
		onSuccess: async () => {
			await refresh();
			toast.success("관심 주제 추천을 요청했습니다.");
		},
		onError: (error) => toast.error(error.message),
	});
	const settings = data.data?.settings;
	const suggesting =
		suggest.isPending ||
		data.data?.jobs.some(
			(job) => job.kind === "interests" && ["queued", "processing", "retry"].includes(job.state)
		);
	return (
		<div className="space-y-6">
			<SettingsPageHeader
				title="북마크 설정"
				description="관심 주제를 관리하고 모델별 AI 사용량을 확인합니다."
				action={
					<Button asChild size="sm">
						<Link href="/main/bookmarks">
							<Bookmark aria-hidden="true" className="size-4" />
							북마크 관리자 열기
							<ArrowRight aria-hidden="true" className="size-4" />
						</Link>
					</Button>
				}
			/>
			<div className="flex flex-wrap items-center gap-2 text-xs" role="status">
				{config.isPending ? (
					<span className="text-muted-foreground">AI 설정 상태 확인 중…</span>
				) : config.error ? (
					<span className="text-destructive">AI 설정 상태를 확인하지 못했습니다.</span>
				) : config.data?.openrouter ? (
					<>
						<CheckCircle2
							aria-hidden="true"
							className="size-4 text-emerald-700 dark:text-emerald-400"
						/>
						<span>AI 설정됨</span>
						<span className="text-muted-foreground">· 월 예산 $1</span>
					</>
				) : (
					<span>AI 사용을 위해 서버 OPENROUTER_API_KEY를 설정해주세요.</span>
				)}
			</div>
			<BookmarkHealthSettingsPanel />
			<section aria-label="이번 달 AI 사용량" className="min-w-0 rounded-xl border bg-card">
				<h2 className="sr-only">AI 사용량</h2>
				<BookmarkAIUsagePanel />
			</section>
			{data.error && (
				<p role="alert" className="text-destructive text-sm">
					{data.error.message}
				</p>
			)}
			<div className="grid min-w-0 items-start gap-5">
				<SettingsSurface
					title="관심 주제"
					description="등록한 주제를 기준으로 AI가 분류와 검토를 돕습니다."
					className="min-w-0 shadow-none"
					action={
						<Button
							size="sm"
							variant="outline"
							disabled={!config.data?.openrouter || Boolean(suggesting)}
							onClick={() => suggest.mutate()}
						>
							{suggesting ? "추천 생성 중…" : "AI 추천 받기"}
						</Button>
					}
				>
					{settings ? (
						<BookmarkInterestEditor
							interests={settings.interests}
							version={settings.interest_version}
							suggestions={settings.suggested_interests}
							refresh={refresh}
						/>
					) : data.error ? (
						<div className="p-5">
							<Button size="sm" variant="outline" onClick={() => data.refetch()}>
								관심 주제 다시 불러오기
							</Button>
						</div>
					) : (
						<p role="status" className="p-5 text-muted-foreground text-sm">
							관심 주제를 불러오는 중…
						</p>
					)}
				</SettingsSurface>
			</div>
			<div className="flex flex-col items-start justify-between gap-3 border-t pt-4 sm:flex-row sm:items-center">
				<div>
					<h2 className="m-0 border-0 p-0 font-medium text-sm">작업 기록</h2>
					<p className="mt-1 text-muted-foreground text-xs">
						실패·중단된 작업을 확인하고 같은 작업을 재개합니다.
					</p>
				</div>
				<Button asChild size="sm" variant="ghost">
					<Link href="/main/bookmarks/activity">
						작업 기록 보기
						<ArrowRight aria-hidden="true" className="size-4" />
					</Link>
				</Button>
			</div>
			{data.data && (
				<ImportSettings
					job={data.data.jobs.find((job) => job.kind === "import")}
					configured={Boolean(config.data?.raindrop)}
					refresh={refresh}
				/>
			)}
			<p className="max-w-prose text-muted-foreground text-xs leading-5">
				청구 여부가 불명확한 요청은 예약액을 유지합니다. 세금·환율·다른 앱의 사용량은 포함하지
				않습니다. 내용 점검 시에는 제목·본문 발췌와 검사 지표만 AI에 전송합니다.
			</p>
		</div>
	);
}

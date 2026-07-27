"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, PauseCircle, PlayCircle, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { CrawlPolicySettings, CrawlSourcePolicy } from "@/lib/crawl-policy-contract";
import { CRAWL_RUNS_QUERY_KEY } from "@/lib/crawl-run-query-options";
import { invalidateThreadQueries } from "@/lib/thread-query-cache";
import { useTRPC } from "@/trpc/client";
import { ManualCrawlError, requestManualCrawl } from "../crawl-client";

const SOURCE_LABELS: Record<CrawlSourcePolicy["source"], string> = {
	arcalive: "Arcalive",
	battlepage: "Battlepage",
	insagirl: "Insagirl",
};

const INTERVAL_PRESETS = [1, 2, 3, 4, 6, 12, 24].map((hours) => ({
	label: `${hours}시간`,
	seconds: hours * 3600,
}));

function formatDate(value: string | null) {
	if (!value) return "기록 없음";
	return new Intl.DateTimeFormat("ko-KR", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function formatInterval(seconds: number) {
	if (seconds % 3600 === 0) return `${seconds / 3600}시간`;
	return `${Math.round(seconds / 60)}분`;
}

function formatRelative(value: string, nowMs: number) {
	const differenceMinutes = Math.ceil((new Date(value).getTime() - nowMs) / 60_000);
	if (differenceMinutes <= 0) return "실행 대기 중";
	if (differenceMinutes < 60) return `${differenceMinutes}분 후`;
	const hours = Math.floor(differenceMinutes / 60);
	const minutes = differenceMinutes % 60;
	return minutes === 0 ? `${hours}시간 후` : `${hours}시간 ${minutes}분 후`;
}

function nextCronBoundary(nowMs: number) {
	return Math.ceil(nowMs / 300_000) * 300_000;
}

function latestStatusLabel(policy: CrawlSourcePolicy) {
	if (!policy.latest) return "실행 기록 없음";
	const status = {
		running: "실행 중",
		succeeded: "성공",
		partial: "부분 성공",
		failed: "실패",
		interrupted: "중단됨",
	}[policy.latest.status];
	return `${policy.latest.trigger === "scheduled" ? "예약" : "수동"} ${status}`;
}

function getNextScheduleText(
	policy: CrawlSourcePolicy,
	schedulerEnabled: boolean,
	scheduleEnabled: boolean,
	nowMs: number
) {
	if (!schedulerEnabled) return "전체 예약 시스템이 중지되어 있습니다.";
	if (!scheduleEnabled) return "이 소스의 예약 수집이 중지되어 있습니다.";
	if (policy.activeRunId) return "현재 실행 종료 후 다음 시각을 계산합니다.";
	return policy.nextScheduledAt
		? `${formatDate(policy.nextScheduledAt)} · ${formatRelative(policy.nextScheduledAt, nowMs)}`
		: "다음 실행 시각을 계산하고 있습니다.";
}

function PolicyCard({
	policy,
	schedulerEnabled,
	nowMs,
	onManualCrawl,
	manualCrawlRunning,
}: {
	policy: CrawlSourcePolicy;
	schedulerEnabled: boolean;
	nowMs: number;
	onManualCrawl: (source: CrawlSourcePolicy["source"]) => Promise<void>;
	manualCrawlRunning: boolean;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [scheduleEnabled, setScheduleEnabled] = useState(policy.scheduleEnabled);
	const [cooldownSeconds, setCooldownSeconds] = useState(policy.cooldownSeconds);
	const updatePolicy = useMutation({
		...trpc.crawlPolicy.update.mutationOptions(),
		onSuccess: (settings) => {
			queryClient.setQueryData(trpc.crawlPolicy.get.queryKey(), settings);
			toast.success(`${SOURCE_LABELS[policy.source]} 수집 정책을 저장했습니다.`);
		},
		onError: (error) => {
			if (error.data?.latestSettings) {
				queryClient.setQueryData(trpc.crawlPolicy.get.queryKey(), error.data.latestSettings);
			}
			toast.error(error.message);
		},
	});

	useEffect(() => {
		setScheduleEnabled(policy.scheduleEnabled);
		setCooldownSeconds(policy.cooldownSeconds);
	}, [policy]);

	const dirty =
		scheduleEnabled !== policy.scheduleEnabled || cooldownSeconds !== policy.cooldownSeconds;
	const willBecomeDue =
		scheduleEnabled &&
		policy.lastFinishedAt !== null &&
		new Date(policy.lastFinishedAt).getTime() + cooldownSeconds * 1000 <= nowMs &&
		(cooldownSeconds !== policy.cooldownSeconds || !policy.scheduleEnabled);

	const handleSave = () => {
		updatePolicy.mutate({
			source: policy.source,
			scheduleEnabled,
			cooldownSeconds,
			expectedUpdatedAt: policy.updatedAt,
		});
	};
	const saving = updatePolicy.isPending;

	const nextSchedule = getNextScheduleText(policy, schedulerEnabled, scheduleEnabled, nowMs);

	return (
		<Card className="flex h-full flex-col" data-testid={`crawl-policy-${policy.source}`}>
			<CardHeader className="space-y-3 pb-4">
				<div className="flex items-start justify-between gap-3">
					<div>
						<h3 className="text-xl">{SOURCE_LABELS[policy.source]}</h3>
						<p className="mt-1 text-muted-foreground text-xs">
							권장 {formatInterval(policy.recommendedCooldownSeconds)} · 실행 예산{" "}
							{policy.runBudgetSeconds}초
						</p>
					</div>
					<Badge variant={scheduleEnabled ? "default" : "secondary"}>
						{scheduleEnabled ? "예약 사용" : "예약 중지"}
					</Badge>
				</div>
				<label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border p-3 text-sm">
					<span>
						<span className="block font-medium">예약 수집</span>
						<span className="text-muted-foreground text-xs">
							수동 실행은 항상 사용할 수 있습니다.
						</span>
					</span>
					<span className="relative inline-flex h-6 w-11 shrink-0 items-center">
						<input
							aria-checked={scheduleEnabled}
							aria-label={`${SOURCE_LABELS[policy.source]} 예약 수집`}
							checked={scheduleEnabled}
							className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
							onChange={(event) => setScheduleEnabled(event.target.checked)}
							role="switch"
							type="checkbox"
						/>
						<span className="pointer-events-none absolute inset-0 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
						<span className="pointer-events-none relative ml-1 size-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-5" />
					</span>
				</label>
			</CardHeader>
			<CardContent className="flex flex-1 flex-col gap-5">
				<fieldset>
					<legend className="font-medium text-sm">최소 수집 간격</legend>
					<div className="mt-2 flex flex-wrap gap-2">
						{INTERVAL_PRESETS.map((preset) => (
							<Button
								key={preset.seconds}
								size="sm"
								type="button"
								variant={cooldownSeconds === preset.seconds ? "secondary" : "outline"}
								onClick={() => setCooldownSeconds(preset.seconds)}
							>
								{preset.label}
							</Button>
						))}
					</div>
					<label className="mt-3 block text-muted-foreground text-xs">
						사용자 지정(분)
						<input
							className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							max={10080}
							min={30}
							step={30}
							type="number"
							value={Math.round(cooldownSeconds / 60)}
							onChange={(event) => {
								const minutes = Number(event.target.value);
								if (Number.isInteger(minutes)) setCooldownSeconds(minutes * 60);
							}}
						/>
					</label>
				</fieldset>

				<div className="rounded-md bg-muted/60 p-3 text-sm">
					<div className="flex items-center gap-2 font-medium">
						<Clock3 aria-hidden="true" className="size-4" />
						다음 예상 실행
					</div>
					<p className="mt-1 text-muted-foreground text-xs" data-testid="next-scheduled-at">
						{nextSchedule}
					</p>
					<p className="mt-2 text-muted-foreground text-xs">
						마지막 종료 {formatDate(policy.lastFinishedAt)} · {latestStatusLabel(policy)}
					</p>
				</div>

				{willBecomeDue ? (
					<Alert>
						<AlertTitle>저장 후 바로 실행 대상이 됩니다.</AlertTitle>
						<AlertDescription>
							예약 시스템이 켜져 있으면 5분 이내 실행될 수 있습니다.
						</AlertDescription>
					</Alert>
				) : null}

				<div className="mt-auto grid gap-2 sm:grid-cols-2">
					<Button
						type="button"
						variant="outline"
						disabled={saving || cooldownSeconds === policy.recommendedCooldownSeconds}
						onClick={() => setCooldownSeconds(policy.recommendedCooldownSeconds)}
					>
						<RotateCcw aria-hidden="true" className="mr-2 size-4" />
						권장값 복원
					</Button>
					<Button type="button" disabled={!dirty || saving} onClick={handleSave}>
						{saving ? "저장 중..." : "변경 저장"}
					</Button>
				</div>

				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button type="button" variant="secondary" disabled={manualCrawlRunning}>
							<PlayCircle aria-hidden="true" className="mr-2 size-4" />
							{manualCrawlRunning ? "수집 중..." : "지금 수집"}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{SOURCE_LABELS[policy.source]} 지금 수집</AlertDialogTitle>
							<AlertDialogDescription>
								예약 설정과 관계없이 즉시 실행합니다. 소스 잠금과 최대 동시성 제한은 유지됩니다.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>취소</AlertDialogCancel>
							<AlertDialogAction onClick={() => onManualCrawl(policy.source)}>
								수집 시작
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</CardContent>
		</Card>
	);
}

interface ManualResult {
	source: CrawlSourcePolicy["source"];
	success: boolean;
	message: string;
}

function getManualErrorMessage(error: unknown) {
	if (error instanceof ManualCrawlError) return `${error.message} (HTTP ${error.httpStatus})`;
	if (error instanceof Error) return error.message;
	return "수집 요청에 실패했습니다.";
}

function QueryFeedback({
	isPending,
	error,
}: {
	isPending: boolean;
	error: { message: string } | null;
}) {
	if (isPending) {
		return <p className="mt-5 text-muted-foreground">수집 정책을 불러오는 중입니다...</p>;
	}
	if (error) {
		return (
			<Alert className="mt-5" variant="destructive">
				<AlertTitle>수집 정책을 불러오지 못했습니다.</AlertTitle>
				<AlertDescription className="mt-2">{error.message}</AlertDescription>
			</Alert>
		);
	}
	return null;
}

function SchedulerSummary({ settings, nowMs }: { settings: CrawlPolicySettings; nowMs: number }) {
	return (
		<Card className="mt-5">
			<CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
				<div className="flex items-center gap-3">
					{settings.schedulerEnabled ? (
						<CheckCircle2 aria-hidden="true" className="size-5 text-emerald-600" />
					) : (
						<PauseCircle aria-hidden="true" className="size-5 text-amber-600" />
					)}
					<div>
						<p className="font-medium">
							예약 시스템 {settings.schedulerEnabled ? "동작 중" : "중지됨"}
						</p>
						<p className="mt-1 text-muted-foreground text-xs">
							DB가 5분마다 실행 대상과 가용 동시성을 확인합니다.
						</p>
					</div>
				</div>
				<div className="text-right text-sm">
					<p className="font-medium">다음 정책 확인</p>
					<p className="mt-1 text-muted-foreground text-xs">
						{formatDate(new Date(nextCronBoundary(nowMs)).toISOString())}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}

function PolicySettingsPanel({
	settings,
	nowMs,
	manualResult,
	manualSource,
	onManualCrawl,
}: {
	settings: CrawlPolicySettings;
	nowMs: number;
	manualResult: ManualResult | null;
	manualSource: CrawlSourcePolicy["source"] | null;
	onManualCrawl: (source: CrawlSourcePolicy["source"]) => Promise<void>;
}) {
	return (
		<>
			<SchedulerSummary settings={settings} nowMs={nowMs} />
			{manualResult ? (
				<Alert className="mt-5" variant={manualResult.success ? "default" : "destructive"}>
					<AlertTitle>
						{SOURCE_LABELS[manualResult.source]} 수동 수집 {manualResult.success ? "완료" : "실패"}
					</AlertTitle>
					<AlertDescription>{manualResult.message}</AlertDescription>
				</Alert>
			) : null}
			<div className="mt-5 grid gap-4 xl:grid-cols-3">
				{settings.sources.map((policy: CrawlSourcePolicy) => (
					<PolicyCard
						key={policy.source}
						policy={policy}
						schedulerEnabled={settings.schedulerEnabled}
						nowMs={nowMs}
						onManualCrawl={onManualCrawl}
						manualCrawlRunning={manualSource !== null}
					/>
				))}
			</div>
		</>
	);
}

export default function CrawlingSettingPage() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [localNow, setLocalNow] = useState(() => Date.now());
	const [manualSource, setManualSource] = useState<CrawlSourcePolicy["source"] | null>(null);
	const [manualResult, setManualResult] = useState<ManualResult | null>(null);
	const query = useQuery({
		...trpc.crawlPolicy.get.queryOptions(),
		refetchInterval: 60_000,
		refetchOnWindowFocus: true,
	});

	useEffect(() => {
		const timer = window.setInterval(() => setLocalNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);

	const serverOffset = query.data
		? new Date(query.data.serverNow).getTime() - query.dataUpdatedAt
		: 0;
	const nowMs = localNow + serverOffset;

	const handleManualCrawl = async (source: CrawlSourcePolicy["source"]) => {
		setManualSource(source);
		setManualResult(null);
		try {
			const result = await requestManualCrawl(source);
			const message = `${result.insertedCount}건 저장 · ${result.skippedCount}건 중복 · 경고 ${result.warningCount}건`;
			setManualResult({ source, success: true, message });
			toast.success(`${SOURCE_LABELS[source]} 수집이 완료되었습니다.`);
			await invalidateThreadQueries(queryClient, ["inbox"]);
		} catch (error) {
			const message = getManualErrorMessage(error);
			setManualResult({ source, success: false, message });
			toast.error(message);
		} finally {
			setManualSource(null);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.crawlPolicy.get.queryKey() }),
				queryClient.invalidateQueries({ queryKey: CRAWL_RUNS_QUERY_KEY }),
			]);
		}
	};

	return (
		<section aria-labelledby="crawl-settings-heading">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 id="crawl-settings-heading">수집 설정</h2>
					<p className="mt-2 text-muted-foreground text-sm">
						소스별 예약 주기를 조정하고 다음 예상 실행 시각을 확인합니다.
					</p>
				</div>
				<Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
					{query.isFetching ? "확인 중..." : "새로고침"}
				</Button>
			</div>

			<QueryFeedback isPending={query.isPending} error={query.isError ? query.error : null} />
			{query.data ? (
				<PolicySettingsPanel
					settings={query.data}
					nowMs={nowMs}
					manualResult={manualResult}
					manualSource={manualSource}
					onManualCrawl={handleManualCrawl}
				/>
			) : null}
		</section>
	);
}

"use client";

import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	RefreshCw,
	ServerCog,
	ShieldCheck,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
	CrawlAlertIncident,
	CrawlAlertSettings,
	CrawlAlertSignal,
	CrawlRun,
	CrawlRunStatus,
	CrawlRunsDashboard as CrawlRunsDashboardData,
	CrawlSource,
	CrawlSourceSummary,
} from "@/lib/crawl-run-contract";
import { createCrawlRunsQueryOptions } from "@/lib/crawl-run-query-options";
import { cn } from "@/lib/utils";
import { useTRPCClient } from "@/trpc/client";
import {
	SettingsFeedback,
	SettingsPageHeader,
	SettingsStatusItem,
	SettingsStatusStrip,
	SettingsSurface,
} from "./admin-ui";

const CrawlRunDetails = dynamic(
	() => import("./crawl-run-details").then((module) => module.CrawlRunDetails),
	{ ssr: false }
);

const ALERT_SIGNAL_LABELS: Record<CrawlAlertSignal, string> = {
	"parser-failure": "Parser failure 2회 연속",
	"parser-volume-drop": "파서 추출량 급감",
	"no-recent-success": "성공 실행 없음",
	"transport-error-rate": "전송 오류율 증가",
};

const STATUS_LABELS: Record<CrawlRunStatus, string> = {
	running: "실행 중",
	succeeded: "성공",
	partial: "부분 성공",
	failed: "실패",
	interrupted: "중단됨",
};

function formatDate(value: string | null) {
	if (!value) return "기록 없음";
	return new Intl.DateTimeFormat("ko-KR", {
		dateStyle: "short",
		timeStyle: "medium",
	}).format(new Date(value));
}

function formatDuration(value: number | null) {
	if (value === null) return "-";
	if (value < 1000) return `${value}ms`;
	return `${(value / 1000).toFixed(1)}초`;
}

function formatHours(seconds: number) {
	return Number.isInteger(seconds / 3600)
		? `${seconds / 3600}시간`
		: `${Math.round(seconds / 60)}분`;
}

function statusVariant(status: CrawlRunStatus) {
	if (status === "failed" || status === "interrupted") return "destructive" as const;
	if (status === "partial" || status === "running") return "secondary" as const;
	return "default" as const;
}

function formatPercent(value: number | null) {
	return value === null ? "기록 없음" : `${(value * 100).toFixed(1)}%`;
}

function formatRemaining(lastSuccessAt: string | null, noSuccessSeconds: number) {
	if (!lastSuccessAt) return "성공 기록 없음 · 첫 실행 후 기준 적용";
	const remaining = new Date(lastSuccessAt).getTime() + noSuccessSeconds * 1000 - Date.now();
	if (remaining <= 0) return `${noSuccessSeconds / 3600}시간 기준 초과`;
	const hours = Math.ceil(remaining / (60 * 60 * 1000));
	return `${hours}시간 남음`;
}

function SourceTrend({ summary }: { summary: CrawlSourceSummary }) {
	const maximum = Math.max(
		1,
		...summary.trend.flatMap((point) => [point.parserValidCount, point.parserMinimumCount])
	);

	return (
		<div className="mt-4" data-testid={`crawl-trend-${summary.source}`}>
			<div className="mb-2 flex items-center justify-between text-muted-foreground text-xs">
				<span>최근 {summary.trend.length}회 파서 추세</span>
				<span>유효 / 최소</span>
			</div>
			{summary.trend.length === 0 ? (
				<p className="text-muted-foreground text-sm">추세 데이터가 없습니다.</p>
			) : (
				<div
					className="flex h-20 items-end gap-1"
					role="img"
					aria-label={`${summary.label} 파서 추세`}
				>
					{summary.trend.map((point) => {
						const validHeight = Math.max(4, (point.parserValidCount / maximum) * 100);
						const minimumHeight = Math.max(2, (point.parserMinimumCount / maximum) * 100);
						return (
							<div
								className="relative h-full min-w-1 flex-1 rounded-sm bg-muted"
								key={point.id}
								title={`${formatDate(point.startedAt)}: ${point.parserValidCount} / ${point.parserMinimumCount}`}
							>
								<div
									className="absolute right-0 bottom-0 left-0 rounded-sm bg-primary/70"
									style={{ height: `${validHeight}%` }}
								/>
								<div
									className="absolute right-0 left-0 border-amber-500 border-t-2"
									style={{ bottom: `${minimumHeight}%` }}
								/>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function SourceRow({
	summary,
	alert,
	settings,
}: {
	summary: CrawlSourceSummary;
	alert?: CrawlAlertIncident;
	settings: CrawlAlertSettings;
}) {
	const failed = summary.latest?.status === "failed" || summary.latest?.status === "interrupted";
	const warning =
		summary.latest?.status === "partial" ||
		summary.latest?.status === "running" ||
		summary.activeAlertCount > 0;
	const StatusIcon = failed || warning ? AlertTriangle : CheckCircle2;

	return (
		<li className="px-4 py-5 sm:px-5" data-testid={`crawl-source-${summary.source}`}>
			<div className="grid gap-5 md:grid-cols-2 md:items-start xl:grid-cols-[1.05fr_0.9fr_1fr_1.2fr_1.45fr] xl:gap-4">
				<div>
					<div className="flex items-center gap-2">
						<StatusIcon
							aria-hidden="true"
							className={cn(
								"size-4",
								failed && "text-red-600 dark:text-red-400",
								warning && !failed && "text-amber-600 dark:text-amber-400",
								!failed && !warning && "text-emerald-600 dark:text-emerald-400"
							)}
						/>
						<h3 className="font-semibold text-base">{summary.label}</h3>
					</div>
					<div className="mt-2 flex flex-wrap gap-2">
						{summary.activeAlertCount > 0 ? <Badge variant="destructive">장애 감지</Badge> : null}
						{summary.latest ? (
							<Badge variant={statusVariant(summary.latest.status)}>
								{STATUS_LABELS[summary.latest.status]}
							</Badge>
						) : (
							<Badge variant="outline">기록 없음</Badge>
						)}
					</div>
				</div>

				<div className="text-sm">
					<div className="font-medium text-muted-foreground text-xs xl:hidden">예약 정책</div>
					<div className="mt-1">
						예약 {summary.scheduleEnabled ? "사용" : "중지"} ·{" "}
						{formatHours(summary.cooldownSeconds)}
					</div>
					<div className="mt-1 text-muted-foreground text-xs">
						실행 예산 {summary.runBudgetSeconds}초
					</div>
				</div>

				<div className="text-sm">
					<div className="font-medium text-muted-foreground text-xs xl:hidden">다음 예약 가능</div>
					<div className="mt-1">{formatDate(summary.nextEligibleAt)}</div>
					<div className="mt-1 text-muted-foreground text-xs">
						무성공 감지까지 {formatRemaining(summary.lastSuccessAt, settings.noSuccessSeconds)}
					</div>
				</div>

				<div className="text-sm">
					<div className="font-medium text-muted-foreground text-xs xl:hidden">최근 상태</div>
					<div className="mt-1">마지막 성공 {formatDate(summary.lastSuccessAt)}</div>
					<div className="mt-1 text-muted-foreground text-xs">
						마지막 실패 {formatDate(summary.lastFailureAt)}
					</div>
					{summary.latest ? (
						<div className="mt-2 text-muted-foreground text-xs leading-5">
							최근 {summary.latest.trigger === "scheduled" ? "예약" : "수동"} ·{" "}
							{summary.latest.extractedCount}건 추출 · {summary.latest.insertedCount}건 저장
							<br />
							재시도 {summary.latest.retryCount}건 · 복구 {summary.latest.recoveredCount}건 ·{" "}
							{formatDuration(summary.latest.durationMs)}
						</div>
					) : null}
				</div>

				<div>
					<div className="font-medium text-muted-foreground text-xs xl:hidden">파서 추세</div>
					<SourceTrend summary={summary} />
				</div>
			</div>

			{alert ? (
				<div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-red-700 text-xs leading-5 dark:bg-red-950/40 dark:text-red-300">
					<div className="font-medium">활성 장애 신호</div>
					<ul className="mt-1 list-disc pl-5">
						{alert.activeSignals.map((signal) => (
							<li key={signal}>{ALERT_SIGNAL_LABELS[signal]}</li>
						))}
					</ul>
				</div>
			) : null}
		</li>
	);
}

function ActiveAlerts({
	alerts,
	labels,
}: {
	alerts: CrawlAlertIncident[];
	labels: ReadonlyMap<CrawlSource, string>;
}) {
	if (alerts.length === 0) {
		return (
			<Alert className="mt-4" data-testid="crawl-alerts-empty">
				<AlertTitle>현재 감지된 소스 장애가 없습니다.</AlertTitle>
				<AlertDescription>정기 모니터가 실행 이력과 파서 추세를 확인합니다.</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="mt-4 space-y-3" data-testid="active-crawl-alerts">
			{alerts.map((alert) => (
				<Alert key={alert.id} variant="destructive">
					<AlertTitle>{labels.get(alert.source) ?? alert.source} 장애 감지</AlertTitle>
					<AlertDescription className="space-y-2">
						<p>
							시작 {formatDate(alert.openedAt)} · 최근 확인 {formatDate(alert.lastObservedAt)}
						</p>
						<ul className="list-disc pl-5">
							{alert.activeSignals.map((signal) => (
								<li key={signal}>{ALERT_SIGNAL_LABELS[signal]}</li>
							))}
						</ul>
						<p>
							parser 비율 {formatPercent(alert.snapshot.parserValidRatio)} · 전송 오류율{" "}
							{formatPercent(alert.snapshot.transportFailureRatio)}
						</p>
					</AlertDescription>
				</Alert>
			))}
		</div>
	);
}

function AlertSettings({ settings }: { settings: CrawlAlertSettings }) {
	return (
		<div className="p-5" data-testid="crawl-alert-settings">
			<h3 className="font-semibold text-sm">장애 감지 기준</h3>
			<div className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
				<div>Parser failure {settings.parserFailureStreak}회 연속</div>
				<div>
					추출량 {Math.round(settings.parserDropRatio * 100)}% 미만 {settings.parserDropStreak}회
					연속
				</div>
				<div>성공 실행 없음 {settings.noSuccessSeconds / 3600}시간</div>
				<div>
					최근 {settings.transportWindow}회 전송 오류율{" "}
					{Math.round(settings.transportErrorRatio * 100)}% 이상
				</div>
				<div className="text-muted-foreground sm:col-span-2">
					마지막 평가 {formatDate(settings.lastEvaluatedAt)}
				</div>
			</div>
		</div>
	);
}

function RuntimeSettings({ dashboard }: { dashboard: CrawlRunsDashboardData }) {
	return (
		<div className="p-5" data-testid="crawl-runtime-settings">
			<h3 className="font-semibold text-sm">수집 실행 정책</h3>
			<div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
				<div>
					<div className="text-muted-foreground text-xs">최대 동시 소스</div>
					<div className="mt-1 font-semibold">{dashboard.runtimeSettings.maxConcurrency}개</div>
				</div>
				<div>
					<div className="text-muted-foreground text-xs">잠금 TTL</div>
					<div className="mt-1 font-semibold">{dashboard.runtimeSettings.lockTtlSeconds}초</div>
				</div>
				<div>
					<div className="text-muted-foreground text-xs">Heartbeat</div>
					<div className="mt-1 font-semibold">
						{dashboard.runtimeSettings.heartbeatIntervalSeconds}초
					</div>
				</div>
			</div>
		</div>
	);
}

function RunDetailsDisclosure({ run }: { run: CrawlRun }) {
	const [open, setOpen] = useState(false);
	const hasDetails =
		run.warnings.length > 0 ||
		run.failures.length > 0 ||
		run.parserObservations.length > 0 ||
		Boolean(run.errorMessage);
	if (!hasDetails) return null;

	return (
		<details
			className="mt-3 rounded-md border p-3 text-sm"
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary className="cursor-pointer font-medium">경고·실패 상세보기</summary>
			{open ? <CrawlRunDetails run={run} /> : null}
		</details>
	);
}

function RunRow({ run, label }: { run: CrawlRun; label: string }) {
	return (
		<li className="px-4 py-4 sm:px-5" data-testid="crawl-run">
			<div className="grid gap-4 lg:grid-cols-[1fr_1.3fr_2fr] lg:items-start">
				<div>
					<div className="flex items-center gap-2">
						<strong>{label}</strong>
						<Badge variant={statusVariant(run.status)}>{STATUS_LABELS[run.status]}</Badge>
					</div>
					<div className="mt-1 text-muted-foreground text-xs">
						{run.trigger === "scheduled" ? "예약 실행" : "수동 실행"}
					</div>
				</div>
				<div className="text-sm">
					<div>{formatDate(run.startedAt)}</div>
					<div className="mt-1 text-muted-foreground text-xs">
						소요 {formatDuration(run.durationMs)} · 재시도 {run.retryCount}건 · 복구{" "}
						{run.recoveredCount}건
					</div>
				</div>
				<div className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm sm:grid-cols-6">
					<div>
						<span className="block text-muted-foreground text-xs">요청</span>
						{run.attemptedCount}
					</div>
					<div>
						<span className="block text-muted-foreground text-xs">성공</span>
						{run.succeededCount}
					</div>
					<div>
						<span className="block text-muted-foreground text-xs">저장</span>
						{run.insertedCount}
					</div>
					<div>
						<span className="block text-muted-foreground text-xs">중복</span>
						{run.skippedCount}
					</div>
					<div>
						<span className="block text-muted-foreground text-xs">경고</span>
						{run.warningCount}
					</div>
					<div>
						<span className="block text-muted-foreground text-xs">실패</span>
						{run.failureCount}
					</div>
				</div>
			</div>
			{run.failureCount > 0 ? (
				<div className="mt-3 text-muted-foreground text-xs">
					network {run.networkFailureCount} · parser {run.parserFailureCount} · timeout{" "}
					{run.timeoutFailureCount}
				</div>
			) : null}
			<RunDetailsDisclosure run={run} />
		</li>
	);
}

export function getCrawlRunsErrorMessage(error: unknown) {
	if (!error || typeof error !== "object") return "알 수 없는 오류가 발생했습니다.";
	const data = Reflect.get(error, "data");
	const code = data && typeof data === "object" ? Reflect.get(data, "code") : undefined;
	switch (code) {
		case "UNAUTHORIZED":
			return "로그인 세션이 만료되었습니다. 다시 로그인한 뒤 시도해주세요.";
		case "FORBIDDEN":
			return "Applemint 소유자 권한이 없어 실행 이력을 볼 수 없습니다.";
		case "SERVICE_UNAVAILABLE":
			return "인증 또는 권한 확인 서비스가 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.";
		default:
			return error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
	}
}

export function CrawlRunsDashboard({ manualCrawlRunning }: { manualCrawlRunning: boolean }) {
	const trpc = useTRPCClient();
	const [now, setNow] = useState(() => Date.now());
	const query = useQuery(createCrawlRunsQueryOptions(trpc, manualCrawlRunning));
	const dashboard: CrawlRunsDashboardData | undefined = query.data;
	const alertsBySource = useMemo(() => {
		const map = new Map<CrawlSource, CrawlAlertIncident>();
		for (const alert of dashboard?.alerts ?? []) {
			if (!map.has(alert.source)) map.set(alert.source, alert);
		}
		return map;
	}, [dashboard]);
	const labelsBySource = useMemo(
		() => new Map((dashboard?.sources ?? []).map((summary) => [summary.source, summary.label])),
		[dashboard]
	);

	useEffect(() => {
		if (!dashboard || dashboard.activeRuns.length === 0) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [dashboard]);

	return (
		<section aria-labelledby="crawl-operations-heading">
			<SettingsPageHeader
				title="수집 운영"
				description="최근 90일 실행, 활성 장애와 소스별 파서 상태를 한 화면에서 확인합니다."
				action={
					<Button
						type="button"
						variant="outline"
						onClick={() => query.refetch()}
						disabled={query.isFetching}
					>
						<RefreshCw
							aria-hidden="true"
							className={cn("mr-2 size-4", query.isFetching && "animate-spin")}
						/>
						{query.isFetching ? "갱신 중..." : "새로고침"}
					</Button>
				}
			/>
			<h2 className="sr-only" id="crawl-operations-heading">
				수집 운영
			</h2>

			{query.isPending ? (
				<SettingsFeedback>실행 이력을 불러오는 중입니다...</SettingsFeedback>
			) : null}
			{query.isError ? (
				<Alert className="mt-6" variant="destructive">
					<AlertTitle>실행 이력을 불러오지 못했습니다.</AlertTitle>
					<AlertDescription className="mt-2">
						<div>{getCrawlRunsErrorMessage(query.error)}</div>
						<Button
							className="mt-3"
							type="button"
							variant="outline"
							onClick={() => query.refetch()}
						>
							다시 시도
						</Button>
					</AlertDescription>
				</Alert>
			) : null}

			{dashboard?.activeRuns.map((activeRun) => (
				<Alert className="mt-5" data-testid="active-crawl-run" key={activeRun.id}>
					<AlertTitle>
						{labelsBySource.get(activeRun.source) ?? activeRun.source} 크롤링 실행 중
					</AlertTitle>
					<AlertDescription>
						시작 {formatDate(activeRun.startedAt)} · 경과{" "}
						{formatDuration(Math.max(0, now - new Date(activeRun.startedAt).getTime()))} · 마지막
						heartbeat {formatDate(activeRun.lastHeartbeatAt)}
					</AlertDescription>
				</Alert>
			))}

			{dashboard ? (
				<>
					<SettingsStatusStrip>
						<SettingsStatusItem
							icon={
								dashboard.alerts.length > 0 ? (
									<AlertTriangle aria-hidden="true" className="size-5" />
								) : (
									<ShieldCheck aria-hidden="true" className="size-5" />
								)
							}
							label="활성 장애"
							value={
								dashboard.alerts.length > 0
									? `${dashboard.alerts.length}개 감지`
									: "감지된 장애 없음"
							}
							supporting={`마지막 평가 ${formatDate(dashboard.alertSettings.lastEvaluatedAt)}`}
							tone={dashboard.alerts.length > 0 ? "danger" : "success"}
						/>
						<SettingsStatusItem
							icon={<Activity aria-hidden="true" className="size-5" />}
							label="현재 실행"
							value={`${dashboard.activeRuns.length} / ${dashboard.runtimeSettings.maxConcurrency}개`}
							supporting="동시 실행 소스"
							tone={dashboard.activeRuns.length > 0 ? "warning" : "neutral"}
						/>
						<SettingsStatusItem
							icon={<ServerCog aria-hidden="true" className="size-5" />}
							label="실행 보호"
							value={`잠금 ${dashboard.runtimeSettings.lockTtlSeconds}초`}
							supporting={`Heartbeat ${dashboard.runtimeSettings.heartbeatIntervalSeconds}초`}
						/>
					</SettingsStatusStrip>

					<ActiveAlerts alerts={dashboard.alerts} labels={labelsBySource} />

					<SettingsSurface className="mt-5" title="소스 상태" contentClassName="divide-y">
						<div className="hidden bg-muted/35 px-5 py-3 font-medium text-muted-foreground text-xs xl:grid xl:grid-cols-[1.05fr_0.9fr_1fr_1.2fr_1.45fr] xl:gap-4">
							<span>수집 소스</span>
							<span>예약 정책</span>
							<span>다음 예약 가능</span>
							<span>최근 상태</span>
							<span>파서 추세</span>
						</div>
						<ul className="divide-y">
							{dashboard.sources.map((summary) => (
								<SourceRow
									key={summary.source}
									summary={summary}
									alert={alertsBySource.get(summary.source)}
									settings={dashboard.alertSettings}
								/>
							))}
						</ul>
					</SettingsSurface>

					<SettingsSurface className="mt-5" title="운영 기준">
						<div className="divide-y md:grid md:grid-cols-2 md:divide-x md:divide-y-0">
							<RuntimeSettings dashboard={dashboard} />
							<AlertSettings settings={dashboard.alertSettings} />
						</div>
					</SettingsSurface>

					<SettingsSurface
						className="mt-5"
						title="최근 실행"
						description={`최대 ${dashboard.runs.length}개의 최근 실행을 표시합니다.`}
					>
						{dashboard.runs.length === 0 ? (
							<div className="px-5 py-10 text-center text-muted-foreground text-sm">
								저장된 크롤링 실행 이력이 없습니다.
							</div>
						) : (
							<ul className="divide-y">
								{dashboard.runs.map((run) => (
									<RunRow
										key={run.id}
										run={run}
										label={labelsBySource.get(run.source) ?? run.source}
									/>
								))}
							</ul>
						)}
					</SettingsSurface>
				</>
			) : null}
		</section>
	);
}

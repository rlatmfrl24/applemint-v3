"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
	CrawlRun,
	CrawlRunStatus,
	CrawlRunsDashboard as CrawlRunsDashboardData,
	CrawlSource,
	CrawlSourceSummary,
} from "@/lib/crawl-run-contract";
import { fetchCrawlRunsDashboard } from "./crawl-runs-client";

export const CRAWL_RUNS_QUERY_KEY = ["crawl-runs", "dashboard"] as const;

const SOURCE_LABELS: Record<CrawlSource, string> = {
	arcalive: "Arcalive",
	battlepage: "Battlepage",
	insagirl: "Insagirl",
	issuelink: "IssueLink",
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

function statusVariant(status: CrawlRunStatus) {
	if (status === "failed" || status === "interrupted") return "destructive" as const;
	if (status === "partial" || status === "running") return "secondary" as const;
	return "default" as const;
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
					aria-label={`${SOURCE_LABELS[summary.source]} 파서 추세`}
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

function SourceCard({ summary }: { summary: CrawlSourceSummary }) {
	return (
		<Card data-testid={`crawl-source-${summary.source}`}>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between gap-2">
					<h3 className="font-semibold">{SOURCE_LABELS[summary.source]}</h3>
					{summary.latest ? (
						<Badge variant={statusVariant(summary.latest.status)}>
							{STATUS_LABELS[summary.latest.status]}
						</Badge>
					) : null}
				</div>
			</CardHeader>
			<CardContent className="space-y-1 text-sm">
				<p>마지막 성공: {formatDate(summary.lastSuccessAt)}</p>
				<p>마지막 실패: {formatDate(summary.lastFailureAt)}</p>
				{summary.latest ? (
					<p className="text-muted-foreground">
						최근 {summary.latest.extractedCount}건 추출 · {summary.latest.insertedCount}건 저장 ·{" "}
						{formatDuration(summary.latest.durationMs)}
					</p>
				) : null}
				<SourceTrend summary={summary} />
			</CardContent>
		</Card>
	);
}

function RunDetails({ run }: { run: CrawlRun }) {
	const hasDetails =
		run.warnings.length > 0 ||
		run.failures.length > 0 ||
		run.parserObservations.length > 0 ||
		Boolean(run.errorMessage);
	if (!hasDetails) return null;

	return (
		<details className="mt-3 rounded-md border p-3 text-sm">
			<summary className="cursor-pointer font-medium">경고·실패 상세보기</summary>
			{run.errorMessage ? (
				<p className="mt-3 text-red-600 dark:text-red-400">
					[{run.errorStage ?? "unknown"}] {run.errorMessage}
				</p>
			) : null}
			{run.failures.length > 0 ? (
				<div className="mt-3">
					<p className="font-medium">실패</p>
					<ul className="mt-1 list-disc space-y-1 pl-5">
						{run.failures.map((failure) => (
							<li
								key={`${failure.url ?? "failure"}-${failure.attempt ?? 0}-${failure.kind ?? "unknown"}-${failure.message ?? ""}`}
							>
								시도 {failure.attempt ?? 1} ·{" "}
								{failure.timeout ? "timeout" : (failure.kind ?? "unknown")} ·{" "}
								{failure.message ?? "상세 없음"}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{run.warnings.length > 0 ? (
				<div className="mt-3">
					<p className="font-medium">경고</p>
					<ul className="mt-1 list-disc space-y-1 pl-5">
						{run.warnings.map((warning) => (
							<li
								key={`${warning.url ?? "warning"}-${warning.attempt ?? 0}-${warning.code ?? "warning"}-${warning.message ?? ""}`}
							>
								시도 {warning.attempt ?? 1} · {warning.code ?? "warning"} ·{" "}
								{warning.message ?? "상세 없음"}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{run.parserObservations.length > 0 ? (
				<div className="mt-3 overflow-x-auto">
					<table className="w-full min-w-2xl text-left text-xs">
						<thead>
							<tr className="border-b">
								<th className="p-2">시도</th>
								<th className="p-2">상태</th>
								<th className="p-2">후보</th>
								<th className="p-2">유효</th>
								<th className="p-2">제외</th>
								<th className="p-2">최소</th>
							</tr>
						</thead>
						<tbody>
							{run.parserObservations.map((observation) => (
								<tr
									className="border-b last:border-0"
									key={`${observation.url}-${observation.attempt ?? 0}`}
								>
									<td className="p-2">{observation.attempt ?? 1}</td>
									<td className="p-2">{observation.status}</td>
									<td className="p-2">{observation.candidateCount}</td>
									<td className="p-2">{observation.validCount}</td>
									<td className="p-2">{observation.discardedCount}</td>
									<td className="p-2">{observation.minimumItems}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
		</details>
	);
}

function RunCard({ run }: { run: CrawlRun }) {
	return (
		<li className="rounded-lg border p-4" data-testid="crawl-run">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<strong>{SOURCE_LABELS[run.source]}</strong>
					<Badge variant={statusVariant(run.status)}>{STATUS_LABELS[run.status]}</Badge>
				</div>
				<span className="text-muted-foreground text-sm">
					{formatDate(run.startedAt)} · {formatDuration(run.durationMs)}
				</span>
			</div>
			<div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
				<span>요청 {run.attemptedCount}</span>
				<span>성공 {run.succeededCount}</span>
				<span>저장 {run.insertedCount}</span>
				<span>중복 {run.skippedCount}</span>
				<span>경고 {run.warningCount}</span>
				<span>실패 {run.failureCount}</span>
			</div>
			{run.failureCount > 0 ? (
				<p className="mt-2 text-muted-foreground text-xs">
					network {run.networkFailureCount} · parser {run.parserFailureCount} · timeout{" "}
					{run.timeoutFailureCount}
				</p>
			) : null}
			<RunDetails run={run} />
		</li>
	);
}

export function CrawlRunsDashboard({ manualCrawlRunning }: { manualCrawlRunning: boolean }) {
	const [now, setNow] = useState(() => Date.now());
	const query = useQuery<CrawlRunsDashboardData>({
		queryKey: CRAWL_RUNS_QUERY_KEY,
		queryFn: () => fetchCrawlRunsDashboard(),
		refetchInterval: (currentQuery) =>
			manualCrawlRunning || currentQuery.state.data?.activeRun ? 5000 : false,
		refetchOnWindowFocus: true,
	});
	const dashboard = query.data as CrawlRunsDashboardData | undefined;

	useEffect(() => {
		if (!dashboard?.activeRun) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [dashboard?.activeRun]);

	return (
		<section className="mt-8" aria-labelledby="crawl-operations-heading">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id="crawl-operations-heading">크롤링 운영 현황</h2>
					<p className="mt-1 text-muted-foreground text-sm">
						최근 90일 실행과 소스별 파서 상태를 확인합니다.
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					onClick={() => query.refetch()}
					disabled={query.isFetching}
				>
					{query.isFetching ? "갱신 중..." : "새로고침"}
				</Button>
			</div>

			{query.isPending ? (
				<p className="mt-4 text-muted-foreground">실행 이력을 불러오는 중입니다...</p>
			) : null}
			{query.isError ? (
				<Alert className="mt-4" variant="destructive">
					<AlertTitle>실행 이력을 불러오지 못했습니다.</AlertTitle>
					<AlertDescription className="mt-2">
						<p>
							{query.error instanceof Error
								? query.error.message
								: "알 수 없는 오류가 발생했습니다."}
						</p>
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

			{dashboard?.activeRun ? (
				<Alert className="mt-4" data-testid="active-crawl-run">
					<AlertTitle>{SOURCE_LABELS[dashboard.activeRun.source]} 크롤링 실행 중</AlertTitle>
					<AlertDescription>
						시작 {formatDate(dashboard.activeRun.startedAt)} · 경과{" "}
						{formatDuration(Math.max(0, now - new Date(dashboard.activeRun.startedAt).getTime()))}
					</AlertDescription>
				</Alert>
			) : null}

			{dashboard ? (
				<>
					<div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
						{dashboard.sources.map((summary) => (
							<SourceCard key={summary.source} summary={summary} />
						))}
					</div>
					<h3 className="mt-8 font-semibold text-lg">최근 실행</h3>
					{dashboard.runs.length === 0 ? (
						<p className="mt-3 text-muted-foreground">저장된 크롤링 실행 이력이 없습니다.</p>
					) : (
						<ul className="mt-3 space-y-3">
							{dashboard.runs.map((run) => (
								<RunCard key={run.id} run={run} />
							))}
						</ul>
					)}
				</>
			) : null}
		</section>
	);
}

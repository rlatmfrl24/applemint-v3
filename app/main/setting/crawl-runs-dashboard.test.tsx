import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
	CrawlRun,
	CrawlRunsDashboard as CrawlRunsDashboardData,
	CrawlSource,
	CrawlSourceSummary,
} from "@/lib/crawl-run-contract";
import { CRAWL_RUNS_QUERY_KEY } from "@/lib/crawl-run-query-options";
import { CrawlRunDetails } from "./crawl-run-details";
import { CrawlRunsDashboard, getCrawlRunsErrorMessage } from "./crawl-runs-dashboard";

vi.mock("@/trpc/client", () => ({
	useTRPCClient: () => ({
		crawl: {
			runs: {
				query: vi.fn(),
			},
		},
	}),
}));

const sources: CrawlSource[] = ["arcalive", "battlepage", "insagirl", "issuelink"];
const sourceLabels: Record<CrawlSource, string> = {
	arcalive: "Arcalive",
	battlepage: "Battlepage",
	insagirl: "Insagirl",
	issuelink: "IssueLink",
};

const alertSettings = {
	parserFailureStreak: 2,
	parserDropRatio: 0.5,
	parserDropStreak: 2,
	noSuccessSeconds: 172800,
	transportWindow: 3,
	transportErrorRatio: 0.5,
	transportMinFailures: 2,
	lastEvaluatedAt: "2026-07-21T05:00:00.000Z",
};

function createRun(overrides: Partial<CrawlRun> = {}): CrawlRun {
	return {
		id: "1",
		source: "arcalive",
		status: "partial",
		trigger: "manual",
		startedAt: "2026-07-21T03:00:00.000Z",
		finishedAt: "2026-07-21T03:00:07.000Z",
		lastHeartbeatAt: null,
		durationMs: 7000,
		retryCount: 1,
		recoveredCount: 0,
		attemptedCount: 6,
		succeededCount: 3,
		extractedCount: 8,
		insertedCount: 4,
		skippedCount: 4,
		warningCount: 1,
		failureCount: 1,
		networkFailureCount: 1,
		parserFailureCount: 0,
		timeoutFailureCount: 0,
		parserValidCount: 8,
		parserMinimumCount: 10,
		warnings: [
			{
				url: "https://example.com/page",
				code: "below-minimum-items",
				severity: "warning",
				message: "최소 미달",
				attempt: 2,
			},
		],
		failures: [
			{
				url: "https://example.com/page",
				kind: "upstream-challenge",
				message: "HTTP 403 Cloudflare Challenge",
				attempt: 1,
			},
		],
		parserObservations: [
			{
				url: "https://example.com/page",
				status: "ok",
				candidateCount: 9,
				validCount: 8,
				discardedCount: 1,
				ignoredCount: 0,
				duplicateCount: 0,
				minimumItems: 10,
				attempt: 2,
			},
		],
		errorStage: null,
		errorMessage: null,
		...overrides,
	};
}

function renderDashboard(dashboard: CrawlRunsDashboardData) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
	});
	queryClient.setQueryData(CRAWL_RUNS_QUERY_KEY, dashboard);
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<CrawlRunsDashboard manualCrawlRunning={false} />
		</QueryClientProvider>
	);
}

function createSourceSummary(
	source: CrawlSource,
	index: number,
	runs: CrawlRun[]
): CrawlSourceSummary {
	const run = runs[index];
	if (!run) {
		return {
			source,
			label: sourceLabels[source],
			scheduleEnabled: true,
			cooldownSeconds: 10800,
			runBudgetSeconds: 45,
			lastFinishedAt: null,
			nextEligibleAt: null,
			activeAlertCount: 0,
			lastSuccessAt: null,
			lastFailureAt: null,
			latest: null,
			trend: [],
		};
	}
	const trendStatus = run.status === "running" ? "interrupted" : run.status;
	return {
		source,
		label: sourceLabels[source],
		scheduleEnabled: true,
		cooldownSeconds: 10800,
		runBudgetSeconds: 45,
		lastFinishedAt: run.finishedAt,
		nextEligibleAt: "2026-07-21T06:00:07.000Z",
		activeAlertCount: index === 0 ? 1 : 0,
		lastSuccessAt: "2026-07-21T03:00:07.000Z",
		lastFailureAt: index === 0 ? "2026-07-21T03:00:07.000Z" : null,
		latest: {
			id: String(index + 1),
			status: run.status,
			trigger: run.trigger,
			startedAt: run.startedAt,
			durationMs: run.durationMs,
			extractedCount: run.extractedCount,
			insertedCount: run.insertedCount,
			retryCount: run.retryCount,
			recoveredCount: run.recoveredCount,
		},
		trend: [
			{
				id: String(index + 1),
				status: trendStatus,
				startedAt: run.startedAt,
				extractedCount: run.extractedCount,
				parserValidCount: run.parserValidCount,
				parserMinimumCount: run.parserMinimumCount,
				failureCount: run.failureCount,
			},
		],
	};
}

describe("CrawlRunsDashboard", () => {
	it("401·403·503 오류에 서로 다른 복구 안내를 제공한다", () => {
		expect(getCrawlRunsErrorMessage({ data: { code: "UNAUTHORIZED" } })).toContain("다시 로그인");
		expect(getCrawlRunsErrorMessage({ data: { code: "FORBIDDEN" } })).toContain("소유자 권한");
		expect(getCrawlRunsErrorMessage({ data: { code: "SERVICE_UNAVAILABLE" } })).toContain(
			"일시적으로 불안정"
		);
	});

	it("실행 중·소스 요약·추세·상세 상태를 렌더링한다", () => {
		const runs = [
			createRun(),
			createRun({
				id: "2",
				source: "battlepage",
				status: "succeeded",
				warnings: [],
				failures: [],
				parserObservations: [],
				warningCount: 0,
				failureCount: 0,
				networkFailureCount: 0,
				timeoutFailureCount: 0,
			}),
			createRun({
				id: "3",
				source: "insagirl",
				status: "failed",
				warnings: [
					{
						code: "discarded-items",
						message: "과거 정보성 진단",
					},
				],
				errorStage: "ingest",
				errorMessage: "DB 적재 실패",
			}),
			createRun({ id: "4", source: "arcalive", status: "interrupted", durationMs: null }),
		];
		const dashboard: CrawlRunsDashboardData = {
			activeRun: {
				id: "5",
				source: "battlepage",
				status: "running",
				startedAt: new Date().toISOString(),
				staleAfter: new Date(Date.now() + 300_000).toISOString(),
				lastHeartbeatAt: new Date().toISOString(),
			},
			activeRuns: [
				{
					id: "5",
					source: "battlepage",
					status: "running",
					startedAt: new Date().toISOString(),
					staleAfter: new Date(Date.now() + 300_000).toISOString(),
					lastHeartbeatAt: new Date().toISOString(),
				},
			],
			runtimeSettings: {
				maxConcurrency: 2,
				lockTtlSeconds: 60,
				heartbeatIntervalSeconds: 15,
			},
			sources: sources.map((source, index) => createSourceSummary(source, index, runs)),
			runs,
			alerts: [
				{
					id: "10",
					source: "arcalive",
					activeSignals: ["parser-failure", "parser-volume-drop"],
					openedAt: "2026-07-21T04:00:00.000Z",
					lastObservedAt: "2026-07-21T05:00:00.000Z",
					snapshot: {
						latestRunId: "1",
						parserFailureTriggered: true,
						parserValidRatio: 0.2,
						lastSuccessAt: null,
						hoursSinceSuccess: 4,
						transportWindow: 3,
						transportAttemptedCount: 6,
						transportFailureCount: 1,
						transportFailureRatio: 1 / 6,
					},
				},
			],
			alertSettings,
		};

		const html = renderDashboard(dashboard);
		expect(html).toContain("Battlepage 크롤링 실행 중");
		expect(html).toContain("부분 성공");
		expect(html).toContain("중단됨");
		expect(html).toContain("경고·실패 상세보기");
		expect(html).not.toContain("below-minimum-items");
		expect(html).toContain("Arcalive 장애 감지");
		expect(html).toContain("IssueLink");
		expect(html).toContain("장애 감지 기준");

		const details = renderToStaticMarkup(<CrawlRunDetails run={runs[0]} />);
		expect(details).toContain("below-minimum-items");
		expect(details).toContain("upstream-challenge");
		expect(details).toContain("후보");

		const errorDetails = renderToStaticMarkup(<CrawlRunDetails run={runs[2]} />);
		expect(errorDetails).toContain("info · discarded-items");
		expect(errorDetails).toContain("DB 적재 실패");
	});

	it("이력이 없을 때 empty 상태를 렌더링한다", () => {
		const html = renderDashboard({
			activeRun: null,
			activeRuns: [],
			runtimeSettings: {
				maxConcurrency: 2,
				lockTtlSeconds: 60,
				heartbeatIntervalSeconds: 15,
			},
			sources: sources.map((source) => ({
				source,
				label: sourceLabels[source],
				scheduleEnabled: true,
				cooldownSeconds: 10800,
				runBudgetSeconds: 45,
				lastFinishedAt: null,
				nextEligibleAt: null,
				activeAlertCount: 0,
				lastSuccessAt: null,
				lastFailureAt: null,
				latest: null,
				trend: [],
			})),
			runs: [],
			alerts: [],
			alertSettings,
		});
		expect(html).toContain("저장된 크롤링 실행 이력이 없습니다.");
		expect(html).toContain("기록 없음");
		expect(html).toContain("현재 감지된 소스 장애가 없습니다.");
	});
});

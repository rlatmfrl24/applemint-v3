import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
	CrawlRun,
	CrawlRunsDashboard as CrawlRunsDashboardData,
	CrawlSource,
	CrawlSourceSummary,
} from "@/lib/crawl-run-contract";
import { CRAWL_RUNS_QUERY_KEY, CrawlRunsDashboard } from "./crawl-runs-dashboard";

const sources: CrawlSource[] = ["arcalive", "battlepage", "insagirl", "issuelink"];

function createRun(overrides: Partial<CrawlRun> = {}): CrawlRun {
	return {
		id: "1",
		source: "arcalive",
		status: "partial",
		startedAt: "2026-07-21T03:00:00.000Z",
		finishedAt: "2026-07-21T03:00:07.000Z",
		durationMs: 7000,
		retryCount: 1,
		attemptedCount: 6,
		succeededCount: 3,
		extractedCount: 8,
		insertedCount: 4,
		skippedCount: 4,
		warningCount: 1,
		failureCount: 1,
		networkFailureCount: 0,
		parserFailureCount: 0,
		timeoutFailureCount: 1,
		parserValidCount: 8,
		parserMinimumCount: 10,
		warnings: [
			{
				url: "https://example.com/page",
				code: "below-minimum-items",
				message: "최소 미달",
				attempt: 2,
			},
		],
		failures: [
			{
				url: "https://example.com/page",
				kind: "network",
				timeout: true,
				message: "timed out",
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
		return { source, lastSuccessAt: null, lastFailureAt: null, latest: null, trend: [] };
	}
	const trendStatus = run.status === "running" ? "interrupted" : run.status;
	return {
		source,
		lastSuccessAt: "2026-07-21T03:00:07.000Z",
		lastFailureAt: index === 0 ? "2026-07-21T03:00:07.000Z" : null,
		latest: {
			id: String(index + 1),
			status: run.status,
			startedAt: run.startedAt,
			durationMs: run.durationMs,
			extractedCount: run.extractedCount,
			insertedCount: run.insertedCount,
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
				errorStage: "ingest",
				errorMessage: "DB 적재 실패",
			}),
			createRun({ id: "4", source: "issuelink", status: "interrupted", durationMs: null }),
		];
		const dashboard: CrawlRunsDashboardData = {
			activeRun: {
				id: "5",
				source: "battlepage",
				status: "running",
				startedAt: new Date().toISOString(),
				staleAfter: new Date(Date.now() + 300_000).toISOString(),
			},
			sources: sources.map((source, index) => createSourceSummary(source, index, runs)),
			runs,
		};

		const html = renderDashboard(dashboard);
		expect(html).toContain("Battlepage 크롤링 실행 중");
		expect(html).toContain("부분 성공");
		expect(html).toContain("중단됨");
		expect(html).toContain("경고·실패 상세보기");
		expect(html).toContain("below-minimum-items");
		expect(html).toContain("DB 적재 실패");
	});

	it("이력이 없을 때 empty 상태를 렌더링한다", () => {
		const html = renderDashboard({
			activeRun: null,
			sources: sources.map((source) => ({
				source,
				lastSuccessAt: null,
				lastFailureAt: null,
				latest: null,
				trend: [],
			})),
			runs: [],
		});
		expect(html).toContain("저장된 크롤링 실행 이력이 없습니다.");
		expect(html).toContain("기록 없음");
	});
});

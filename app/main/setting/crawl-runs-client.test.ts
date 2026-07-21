import { describe, expect, it, vi } from "vitest";
import { fetchCrawlRunsDashboard } from "./crawl-runs-client";

describe("crawl runs client", () => {
	it("정상 dashboard 응답을 반환한다", async () => {
		const dashboard = {
			activeRun: null,
			sources: [],
			runs: [],
			alerts: [],
			alertSettings: {
				parserFailureStreak: 2,
				parserDropRatio: 0.5,
				parserDropStreak: 2,
				noSuccessSeconds: 172800,
				transportWindow: 3,
				transportErrorRatio: 0.5,
				transportMinFailures: 2,
				cooldownSeconds: 86400,
				lastEvaluatedAt: null,
			},
		};
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(dashboard), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})
		);

		await expect(fetchCrawlRunsDashboard(fetchMock)).resolves.toEqual(dashboard);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/crawl/runs?limit=20&trendLimit=20",
			expect.objectContaining({ method: "GET", cache: "no-store" })
		);
	});

	it("오류 응답의 메시지와 기본 HTTP 오류를 구분한다", async () => {
		const structuredFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: "조회 거부" }), {
				status: 403,
				headers: { "Content-Type": "application/json" },
			})
		);
		await expect(fetchCrawlRunsDashboard(structuredFetch)).rejects.toThrow("조회 거부");

		const emptyFetch = vi.fn().mockResolvedValue(new Response("invalid", { status: 500 }));
		await expect(fetchCrawlRunsDashboard(emptyFetch)).rejects.toThrow("(500)");
	});

	it("손상된 성공 응답을 거부한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ sources: null, runs: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})
		);
		await expect(fetchCrawlRunsDashboard(fetchMock)).rejects.toThrow("응답이 올바르지 않습니다");
	});
});

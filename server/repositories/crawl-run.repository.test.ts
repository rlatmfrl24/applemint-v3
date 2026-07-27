import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { crawlAlertsDashboard, crawlRunsBaseDashboard } from "@/test/support/communication";
import { CrawlRunRepository } from "./crawl-run.repository";

describe("CrawlRunRepository", () => {
	const rpc = vi.fn();
	const repository = new CrawlRunRepository({ rpc } as unknown as SupabaseClient);

	beforeEach(() => rpc.mockReset());

	it("검증한 limit과 trendLimit을 실행 이력 RPC에 전달한다", async () => {
		rpc.mockResolvedValue({ data: crawlRunsBaseDashboard, error: null });
		await expect(repository.getRuns({ limit: 12, trendLimit: 8 })).resolves.toEqual(
			crawlRunsBaseDashboard
		);
		expect(rpc).toHaveBeenCalledWith("get_crawl_runs_dashboard", {
			p_limit: 12,
			p_trend_limit: 8,
		});
	});

	it("장애 알림 dashboard를 별도 RPC에서 검증한다", async () => {
		rpc.mockResolvedValue({ data: crawlAlertsDashboard, error: null });
		await expect(repository.getAlerts()).resolves.toEqual(crawlAlertsDashboard);
		expect(rpc).toHaveBeenCalledWith("get_crawl_alerts_dashboard");
	});

	it("RPC 오류와 손상된 응답을 fail closed 한다", async () => {
		rpc.mockResolvedValueOnce({
			data: null,
			error: { code: "XX000", message: "unavailable", details: "", hint: "" },
		});
		await expect(repository.getRuns({ limit: 20, trendLimit: 20 })).rejects.toMatchObject({
			code: "UnexpectedFailure",
		});

		rpc.mockResolvedValueOnce({
			data: { ...crawlRunsBaseDashboard, sources: null },
			error: null,
		});
		await expect(repository.getRuns({ limit: 20, trendLimit: 20 })).rejects.toMatchObject({
			code: "UnexpectedFailure",
		});

		rpc.mockResolvedValueOnce({ data: null, error: null });
		await expect(repository.getAlerts()).rejects.toMatchObject({ code: "UnexpectedFailure" });
	});
});

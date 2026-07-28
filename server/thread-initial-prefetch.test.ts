import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { threadListQueryKey, threadStatsQueryKey } from "@/lib/thread-list-contract";
import { DomainError } from "@/server/errors/domain-error";
import { RequestMetrics } from "@/server/observability/request-metrics";
import { threadRow } from "@/test/support/communication";
import { prefetchInitialThreadData } from "./thread-initial-prefetch";

function createThreadServices() {
	const page = {
		items: [{ ...threadRow, id: "3", state: "inbox" as const }],
		nextCursor: null,
	};
	const stats = {
		counts: [{ key: "normal", label: "일반", count: 1 }],
		totalCount: 1,
	};
	const list = vi.fn().mockResolvedValue(page);
	const getStats = vi.fn().mockResolvedValue(stats);
	return {
		services: {
			thread: {
				list,
				stats: getStats,
			},
		},
		list,
		getStats,
		page,
		stats,
	};
}

describe("initial thread prefetch", () => {
	beforeEach(() => {
		vi.spyOn(console, "info").mockImplementation(() => undefined);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
	});

	it("신규 목록과 통계를 동시에 시작하고 기존 key 구조로 저장한다", async () => {
		const queryClient = new QueryClient();
		const metrics = new RequestMetrics();
		const { services, list, getStats, page, stats } = createThreadServices();

		const pending = prefetchInitialThreadData({
			queryClient,
			services,
			metrics,
			requestId: "request-rsc-1",
			state: "inbox",
			includeStats: true,
		});

		expect(list).toHaveBeenCalledOnce();
		expect(getStats).toHaveBeenCalledOnce();
		await expect(pending).resolves.toEqual({
			listStatus: "fulfilled",
			statsStatus: "fulfilled",
		});
		expect(queryClient.getQueryData(threadListQueryKey("inbox"))).toEqual({
			pages: [page],
			pageParams: [undefined],
		});
		expect(queryClient.getQueryData(threadStatsQueryKey("inbox"))).toEqual(stats);
		expect(console.info).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "request-rsc-1",
				transport: "rsc",
				operation: "thread.initial",
				state: "inbox",
				repositoryCallCount: 0,
				resultCount: 2,
				outcome: "succeeded",
			})
		);
	});

	it("Quick과 Trash는 통계 없이 첫 목록만 저장한다", async () => {
		const queryClient = new QueryClient();
		const { services, getStats } = createThreadServices();

		await prefetchInitialThreadData({
			queryClient,
			services,
			metrics: new RequestMetrics(),
			requestId: "request-rsc-2",
			state: "saved",
		});

		expect(queryClient.getQueryData(threadListQueryKey("saved"))).toBeDefined();
		expect(queryClient.getQueryData(threadStatsQueryKey("saved"))).toBeUndefined();
		expect(getStats).not.toHaveBeenCalled();
	});

	it("목록 선조회 실패는 hydration에서 제외하고 클라이언트 fallback을 허용한다", async () => {
		const queryClient = new QueryClient();
		const { services, list } = createThreadServices();
		list.mockRejectedValue(new DomainError("UnexpectedFailure", "database unavailable"));

		await expect(
			prefetchInitialThreadData({
				queryClient,
				services,
				metrics: new RequestMetrics(),
				requestId: "request-rsc-3",
				state: "trash",
			})
		).resolves.toEqual({
			listStatus: "rejected",
			statsStatus: "skipped",
		});

		expect(queryClient.getQueryData(threadListQueryKey("trash"))).toBeUndefined();
		expect(console.error).toHaveBeenCalledWith(
			expect.objectContaining({
				outcome: "failed",
				errorCode: "UnexpectedFailure",
			})
		);
	});
});

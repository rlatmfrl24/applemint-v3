import { describe, expect, it } from "vitest";
import { RequestMetrics } from "./request-metrics";

describe("RequestMetrics", () => {
	it("Auth·owner·repository 호출과 결과 건수를 요청 단위로 집계한다", async () => {
		const metrics = new RequestMetrics();
		metrics.recordAuthCheck(2.4, "succeeded");
		metrics.recordOwnerCheck(3.4, "succeeded");
		await metrics.measureRepository("thread.list", async () => ["one", "two"]);
		metrics.recordResult({ items: ["one", "two"] });

		expect(metrics.snapshot()).toMatchObject({
			authCallCount: 1,
			ownerCallCount: 1,
			repositoryCallCount: 1,
			repositoryCalls: [
				{
					operation: "thread.list",
					callCount: 1,
					durationMs: expect.any(Number),
				},
			],
			downstreamCallCount: 3,
			resultCount: 2,
			failureCount: 0,
		});
	});

	it("repository 실패도 호출 수와 시간을 누락하지 않는다", async () => {
		const metrics = new RequestMetrics();
		await expect(
			metrics.measureRepository("thread.list", async () => {
				throw new Error("failed");
			})
		).rejects.toThrow("failed");
		metrics.recordFailure("UnexpectedFailure", "failed");

		expect(metrics.snapshot()).toMatchObject({
			repositoryCallCount: 1,
			downstreamCallCount: 1,
			failureCount: 1,
			outcome: "failed",
			errorCode: "UnexpectedFailure",
		});
	});

	it("취소가 같은 요청의 입력 오류를 덮어쓰지 않는다", () => {
		const metrics = new RequestMetrics();
		metrics.recordCancellation("CLIENT_CLOSED_REQUEST");
		metrics.recordFailure("BAD_REQUEST", "rejected");
		metrics.recordCancellation("CLIENT_CLOSED_REQUEST");

		expect(metrics.snapshot()).toMatchObject({
			failureCount: 1,
			outcome: "rejected",
			errorCode: "BAD_REQUEST",
		});
	});
});

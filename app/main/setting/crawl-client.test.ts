import { describe, expect, it, vi } from "vitest";
import { ManualCrawlError, requestManualCrawl, withLoadingState } from "./crawl-client";

describe("manual crawl client", () => {
	it("HTTP 상태와 구조화 결과를 함께 반환한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					runId: "42",
					status: "succeeded",
					target: "arcalive",
					insertedCount: 2,
					skippedCount: 3,
					warningCount: 1,
					durationMs: 100,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } }
			)
		);

		await expect(requestManualCrawl("arcalive", fetchMock)).resolves.toMatchObject({
			httpStatus: 200,
			target: "arcalive",
			insertedCount: 2,
		});
	});

	it("실패 응답의 HTTP 상태와 body를 보존한다", async () => {
		const body = { error: "다른 크롤링 작업이 이미 실행 중입니다." };
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(body), {
				status: 409,
				headers: { "Content-Type": "application/json" },
			})
		);

		const error = await requestManualCrawl("arcalive", fetchMock).catch((caught) => caught);

		expect(error).toBeInstanceOf(ManualCrawlError);
		expect(error).toMatchObject({ httpStatus: 409, responseBody: body });
	});

	it("작업 실패 시에도 loading 상태를 복원한다", async () => {
		const loadingStates: boolean[] = [];

		await expect(
			withLoadingState(
				(value) => loadingStates.push(value),
				async () => {
					throw new Error("failed");
				}
			)
		).rejects.toThrow("failed");
		expect(loadingStates).toEqual([true, false]);
	});
});

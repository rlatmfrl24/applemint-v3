import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCrawlPipelineResult } from "@/test/support/crawl";
import { createOwnerClientMock } from "@/test/support/supabase";

const createClientMock = vi.hoisted(() => vi.fn());
const createServiceRoleClientMock = vi.hoisted(() => vi.fn());
const executeCrawlPipelineMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/utils/supabase/service-role", () => ({
	createServiceRoleClient: createServiceRoleClientMock,
}));
vi.mock("../pipeline", () => {
	class MockCrawlPipelineError extends Error {
		constructor(
			message: string,
			readonly httpStatus: number,
			readonly stage: string,
			readonly crawlData: unknown = null,
			readonly runId?: string,
			readonly activeRunId?: string | null
		) {
			super(message);
		}
	}
	return {
		CrawlPipelineError: MockCrawlPipelineError,
		executeCrawlPipeline: executeCrawlPipelineMock,
	};
});

import { CrawlPipelineError } from "../pipeline";
import { maxDuration, POST } from "./route";

function createRequest(target: unknown) {
	return new Request("http://localhost/api/crawl/manual", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ target }),
	}) as NextRequest;
}

function mockAccess(options: Parameters<typeof createOwnerClientMock>[0] = {}) {
	createClientMock.mockResolvedValue(createOwnerClientMock(options).client);
}

describe("POST /api/crawl/manual", () => {
	beforeEach(() => {
		createServiceRoleClientMock.mockReset();
		createServiceRoleClientMock.mockReturnValue({ kind: "service-role-client" });
		executeCrawlPipelineMock.mockReset();
		mockAccess();
	});

	it("함수 실행 제한은 Vercel Hobby 허용 범위 안이다", () => {
		expect(maxDuration).toBeGreaterThanOrEqual(1);
		expect(maxDuration).toBeLessThanOrEqual(60);
	});

	it("인증과 target 입력을 경계에서 검증한다", async () => {
		mockAccess({ userId: null });
		expect((await POST(createRequest("arcalive"))).status).toBe(401);

		mockAccess();
		expect((await POST(createRequest("invalid"))).status).toBe(400);
		mockAccess();
		expect(
			(
				await POST(
					new Request("http://localhost/api/crawl/manual", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ target: "arcalive", extra: true }),
					}) as NextRequest
				)
			).status
		).toBe(400);

		mockAccess();
		const malformed = new Request("http://localhost/api/crawl/manual", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{",
		}) as NextRequest;
		expect((await POST(malformed)).status).toBe(400);
		expect(executeCrawlPipelineMock).not.toHaveBeenCalled();
	});

	it("통합 Next 파이프라인 결과를 반환한다", async () => {
		executeCrawlPipelineMock.mockResolvedValue(createCrawlPipelineResult());

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ runId: "42", insertedCount: 3 });
		expect(executeCrawlPipelineMock).toHaveBeenCalledWith(
			"arcalive",
			createServiceRoleClientMock.mock.results[0].value
		);
	});

	it("lock 충돌과 timeout을 구조화된 오류로 반환한다", async () => {
		executeCrawlPipelineMock.mockRejectedValueOnce(
			new CrawlPipelineError(
				"다른 크롤링 작업이 이미 실행 중입니다.",
				409,
				"unknown",
				null,
				undefined,
				"41"
			)
		);
		const conflict = await POST(createRequest("arcalive"));
		expect(conflict.status).toBe(409);
		expect(await conflict.json()).toEqual({
			error: "다른 크롤링 작업이 이미 실행 중입니다.",
			activeRunId: "41",
		});

		mockAccess();
		executeCrawlPipelineMock.mockRejectedValueOnce(
			new CrawlPipelineError("timeout", 504, "source", null, "42")
		);
		const timeout = await POST(createRequest("arcalive"));
		expect(timeout.status).toBe(504);
		expect(await timeout.json()).toEqual({
			runId: "42",
			status: "failed",
			error: "크롤링 요청 시간이 초과되었습니다.",
		});
	});

	it("서버 설정과 예상하지 못한 오류를 안전하게 닫는다", async () => {
		createServiceRoleClientMock.mockImplementationOnce(() => {
			throw new Error("missing service role key");
		});
		expect((await POST(createRequest("arcalive"))).status).toBe(503);

		mockAccess();
		executeCrawlPipelineMock.mockRejectedValueOnce(new Error("unexpected"));
		expect((await POST(createRequest("arcalive"))).status).toBe(500);
	});
});

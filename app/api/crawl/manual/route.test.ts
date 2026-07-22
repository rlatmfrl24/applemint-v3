import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
const createServiceRoleClientMock = vi.hoisted(() => vi.fn());
const executeCrawlPipelineMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({
	createClient: createClientMock,
}));

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

const INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";

function createRequest(target: unknown) {
	return new Request("http://localhost/api/crawl/manual", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ target }),
	}) as NextRequest;
}

function mockAccess({
	userId = "owner",
	isOwner = true,
	ownerError = null,
}: {
	userId?: string | null;
	isOwner?: boolean;
	ownerError?: Error | null;
} = {}) {
	createClientMock.mockResolvedValue({
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: userId ? { id: userId } : null },
				error: null,
			}),
		},
		rpc: vi.fn().mockResolvedValue({ data: isOwner, error: ownerError }),
	});
}

describe("POST /api/crawl/manual", () => {
	it("함수 실행 제한은 Vercel Hobby 허용 범위 안이다", () => {
		expect(maxDuration).toBeGreaterThanOrEqual(1);
		expect(maxDuration).toBeLessThanOrEqual(60);
	});

	beforeEach(() => {
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
		vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
		vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
		vi.stubEnv("CRAWL_INTERNAL_SECRET", INTERNAL_SECRET);
		vi.stubEnv("CRAWL_EXECUTION_MODE", "edge");
		createServiceRoleClientMock.mockReturnValue({ kind: "service-role-client" });
		executeCrawlPipelineMock.mockReset();
		mockAccess();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("미로그인 사용자는 401을 반환한다", async () => {
		mockAccess({ userId: null });

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(401);
	});

	it("DB가 소유자로 확인하지 않은 사용자는 403을 반환한다", async () => {
		mockAccess({ isOwner: false });

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(403);
	});

	it("잘못된 target은 400을 반환한다", async () => {
		const response = await POST(createRequest("invalid"));

		expect(response.status).toBe(400);
	});

	it("소유자 권한을 확인할 수 없으면 503으로 닫힌다", async () => {
		mockAccess({ ownerError: new Error("rpc unavailable") });

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(503);
	});

	it("CRAWL_ALLOWED_USER_IDS 없이도 소유자는 수동 크롤링을 실행한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ target: "arcalive", insertedCount: 0 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})
		);
		vi.stubGlobal("fetch", fetchMock);

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("Edge의 409 상태와 구조화 응답을 그대로 전달한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: "already running" }), {
				status: 409,
				headers: { "Content-Type": "application/json" },
			})
		);
		vi.stubGlobal("fetch", fetchMock);

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "already running" });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://project.supabase.co/functions/v1/crawl-source",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"x-applemint-internal-secret": INTERNAL_SECRET,
				}),
			})
		);
	});

	it("Edge 요청 timeout은 504를 반환한다", async () => {
		const timeoutError = new Error("timed out");
		timeoutError.name = "TimeoutError";
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(504);
	});

	it("next 모드에서는 Edge 호출 없이 통합 파이프라인 결과를 반환한다", async () => {
		vi.stubEnv("CRAWL_EXECUTION_MODE", "next");
		executeCrawlPipelineMock.mockResolvedValue({
			runId: "42",
			status: "succeeded",
			target: "arcalive",
			insertedCount: 3,
			skippedCount: 1,
			warningCount: 0,
			durationMs: 123,
		});
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ runId: "42", insertedCount: 3 });
		expect(executeCrawlPipelineMock).toHaveBeenCalledWith(
			"arcalive",
			createServiceRoleClientMock.mock.results[0].value
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("실행 모드를 생략하면 Next 직접 실행을 사용한다", async () => {
		vi.stubEnv("CRAWL_EXECUTION_MODE", "");
		executeCrawlPipelineMock.mockResolvedValue({ runId: "43", status: "succeeded" });

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(200);
		expect(executeCrawlPipelineMock).toHaveBeenCalledOnce();
	});

	it("잘못된 실행 모드는 503으로 닫힌다", async () => {
		vi.stubEnv("CRAWL_EXECUTION_MODE", "legacy");

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(503);
		expect(executeCrawlPipelineMock).not.toHaveBeenCalled();
	});

	it("next 모드의 lock 충돌은 기존 409 응답 계약을 유지한다", async () => {
		vi.stubEnv("CRAWL_EXECUTION_MODE", "next");
		executeCrawlPipelineMock.mockRejectedValue(
			new CrawlPipelineError(
				"다른 크롤링 작업이 이미 실행 중입니다.",
				409,
				"unknown",
				null,
				undefined,
				"41"
			)
		);

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "다른 크롤링 작업이 이미 실행 중입니다.",
			activeRunId: "41",
		});
	});

	it("next 모드의 timeout 실패는 runId와 504를 반환한다", async () => {
		vi.stubEnv("CRAWL_EXECUTION_MODE", "next");
		executeCrawlPipelineMock.mockRejectedValue(
			new CrawlPipelineError("timeout", 504, "source", null, "42")
		);

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(504);
		expect(await response.json()).toEqual({
			runId: "42",
			status: "failed",
			error: "크롤링 요청 시간이 초과되었습니다.",
		});
	});

	it("next 모드의 service-role 설정 오류는 503을 반환한다", async () => {
		vi.stubEnv("CRAWL_EXECUTION_MODE", "next");
		createServiceRoleClientMock.mockImplementation(() => {
			throw new Error("missing service role key");
		});

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: "수동 크롤링 서버 설정이 완료되지 않았습니다.",
		});
		expect(executeCrawlPipelineMock).not.toHaveBeenCalled();
	});

	it("next 모드의 예상하지 못한 실행 오류는 500을 반환한다", async () => {
		vi.stubEnv("CRAWL_EXECUTION_MODE", "next");
		executeCrawlPipelineMock.mockRejectedValue(new Error("unexpected"));

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "크롤링 처리에 실패했습니다." });
	});
});

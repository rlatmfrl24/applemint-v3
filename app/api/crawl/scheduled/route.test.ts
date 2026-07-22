import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createServiceRoleClientMock = vi.hoisted(() => vi.fn());
const executeCrawlPipelineMock = vi.hoisted(() => vi.fn());

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
			readonly activeRunId?: string | null,
			readonly admissionReason?: string,
			readonly nextEligibleAt?: string | null,
			readonly retryAfterSeconds?: number
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
import { POST } from "./route";

const INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";

function request(target: unknown, secret = INTERNAL_SECRET) {
	return new Request("http://localhost/api/crawl/scheduled", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-applemint-internal-secret": secret },
		body: JSON.stringify({ target }),
	}) as NextRequest;
}

describe("POST /api/crawl/scheduled", () => {
	beforeEach(() => {
		vi.stubEnv("CRAWL_INTERNAL_SECRET", INTERNAL_SECRET);
		vi.stubEnv("CRAWL_EXECUTION_MODE", "next");
		createServiceRoleClientMock.mockReturnValue({ kind: "service-client" });
		executeCrawlPipelineMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("내부 secret과 활성 target을 검증한다", async () => {
		expect((await POST(request("arcalive", "wrong"))).status).toBe(401);
		expect((await POST(request("issuelink"))).status).toBe(400);
	});

	it("Next 경로를 scheduled trigger로 실행한다", async () => {
		executeCrawlPipelineMock.mockResolvedValue({ runId: "42", status: "succeeded" });

		const response = await POST(request("battlepage"));

		expect(response.status).toBe(200);
		expect(executeCrawlPipelineMock).toHaveBeenCalledWith(
			"battlepage",
			createServiceRoleClientMock.mock.results[0].value,
			undefined,
			{ trigger: "scheduled" }
		);
	});

	it("실행 모드를 생략하면 권장 Next 경로를 사용한다", async () => {
		vi.stubEnv("CRAWL_EXECUTION_MODE", "");
		executeCrawlPipelineMock.mockResolvedValue({ runId: "43", status: "succeeded" });

		const response = await POST(request("arcalive"));

		expect(response.status).toBe(200);
		expect(executeCrawlPipelineMock).toHaveBeenCalledOnce();
	});

	it("잘못된 실행 모드는 503으로 닫힌다", async () => {
		vi.stubEnv("CRAWL_EXECUTION_MODE", "legacy");

		const response = await POST(request("arcalive"));

		expect(response.status).toBe(503);
		expect(executeCrawlPipelineMock).not.toHaveBeenCalled();
	});

	it("cooldown은 정상 skip으로 반환한다", async () => {
		executeCrawlPipelineMock.mockRejectedValue(
			new CrawlPipelineError(
				"cooldown",
				409,
				"unknown",
				null,
				undefined,
				null,
				"cooldown",
				"2026-07-22T06:00:00.000Z"
			)
		);

		const response = await POST(request("arcalive"));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ status: "skipped", reason: "cooldown" });
	});

	it("capacity는 Retry-After를 포함한 429로 반환한다", async () => {
		executeCrawlPipelineMock.mockRejectedValue(
			new CrawlPipelineError(
				"capacity",
				429,
				"unknown",
				null,
				undefined,
				null,
				"capacity",
				null,
				30
			)
		);

		const response = await POST(request("insagirl"));

		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBe("30");
	});

	it("Edge 호환 경로에 scheduled trigger를 전달한다", async () => {
		vi.stubEnv("CRAWL_EXECUTION_MODE", "edge");
		vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
		vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ status: "skipped", reason: "cooldown" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})
		);
		vi.stubGlobal("fetch", fetchMock);

		const response = await POST(request("arcalive"));

		expect(response.status).toBe(200);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			target: "arcalive",
			trigger: "scheduled",
		});
	});
});

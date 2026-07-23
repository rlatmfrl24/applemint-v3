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
		createServiceRoleClientMock.mockReset();
		createServiceRoleClientMock.mockReturnValue({ kind: "service-client" });
		executeCrawlPipelineMock.mockReset();
	});

	afterEach(() => vi.unstubAllEnvs());

	it("내부 secret과 활성 target을 검증한다", async () => {
		expect((await POST(request("arcalive", "wrong"))).status).toBe(401);
		expect((await POST(request("issuelink"))).status).toBe(400);

		vi.stubEnv("CRAWL_INTERNAL_SECRET", "");
		expect((await POST(request("arcalive"))).status).toBe(503);
	});

	it("통합 Next 파이프라인을 scheduled trigger로 실행한다", async () => {
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

	it("cooldown과 capacity 응답 계약을 유지한다", async () => {
		executeCrawlPipelineMock.mockRejectedValueOnce(
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
		const cooldown = await POST(request("arcalive"));
		expect(cooldown.status).toBe(200);
		expect(await cooldown.json()).toMatchObject({ status: "skipped", reason: "cooldown" });

		executeCrawlPipelineMock.mockRejectedValueOnce(
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
		const capacity = await POST(request("insagirl"));
		expect(capacity.status).toBe(429);
		expect(capacity.headers.get("Retry-After")).toBe("30");
	});

	it("service-role 설정 오류는 503을 반환한다", async () => {
		createServiceRoleClientMock.mockImplementation(() => {
			throw new Error("missing service role key");
		});
		expect((await POST(request("arcalive"))).status).toBe(503);
	});
});

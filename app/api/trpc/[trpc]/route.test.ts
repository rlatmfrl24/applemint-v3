import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/server/errors/domain-error";
import { RequestMetrics } from "@/server/observability/request-metrics";
import type { TRPCContext } from "@/server/trpc/context";
import { crawlPolicySettings } from "@/test/support/communication";

const createContextMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/trpc/context", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/server/trpc/context")>();
	return {
		...actual,
		createTRPCContext: createContextMock,
	};
});

import { GET, getBatchSize, POST } from "./route";

function createContext(): TRPCContext {
	return {
		requestId: "request-1",
		metrics: new RequestMetrics(),
		services: {
			thread: {
				list: vi.fn(),
				stats: vi.fn(),
				transition: vi.fn(),
				bulkTrashInbox: vi.fn(),
			},
			crawlPolicy: {
				get: vi.fn(),
				update: vi.fn().mockRejectedValue(
					new DomainError("StateConflict", "다른 화면에서 변경되었습니다.", {
						latestSettings: crawlPolicySettings,
					})
				),
			},
			crawlRun: {
				getDashboard: vi.fn(),
			},
		} as unknown as TRPCContext["services"],
		getAuthenticatedAccess: vi.fn().mockResolvedValue({
			kind: "authenticated",
			claims: { sub: "owner" },
		}),
		getOwnerAccess: vi.fn().mockResolvedValue({ kind: "owner" }),
	};
}

describe("tRPC route", () => {
	beforeEach(() => {
		createContextMock.mockReset();
		vi.spyOn(console, "info").mockImplementation(() => undefined);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
	});

	it("procedure path에서 batch 크기를 계산한다", () => {
		expect(
			getBatchSize(new Request("http://localhost/api/trpc/thread.list,thread.stats?batch=1"))
		).toBe(2);
	});

	it("context 초기화 오류의 내부 메시지를 숨기고 request ID를 보존한다", async () => {
		createContextMock.mockRejectedValue(
			new Error("NEXT_PUBLIC_SUPABASE_URL is not defined. Internal detail.")
		);

		const response = await GET(
			new Request('http://localhost/api/trpc/thread.stats?input={"state":"inbox"}', {
				headers: { "x-request-id": "request-context-failure" },
			})
		);
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body.error).toMatchObject({
			message: "요청을 처리하지 못했습니다.",
			data: {
				code: "INTERNAL_SERVER_ERROR",
				requestId: "request-context-failure",
			},
		});
		expect(JSON.stringify(body)).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
		expect(console.error).toHaveBeenCalledTimes(1);
		expect(console.error).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "request-context-failure",
				operation: "thread.stats",
				outcome: "failed",
				errorCode: "UnexpectedFailure",
			})
		);
		expect(console.info).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "request-context-failure",
				event: "request",
				batchSize: 1,
				responseBytes: expect.any(Number),
				outcome: "failed",
			})
		);
	});

	it("procedure 오류를 request ID와 함께 한 번만 기록한다", async () => {
		createContextMock.mockResolvedValue(createContext());

		const response = await POST(
			new Request("http://localhost/api/trpc/crawlPolicy.update", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-request-id": "request-1",
				},
				body: JSON.stringify({
					source: "arcalive",
					scheduleEnabled: false,
					cooldownSeconds: 3600,
					expectedUpdatedAt: "2026-07-22T12:00:00.000Z",
				}),
			})
		);

		expect(response.status).toBe(409);
		expect(console.error).toHaveBeenCalledTimes(1);
		expect(console.error).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "request-1",
				operation: "crawlPolicy.update",
				outcome: "rejected",
				errorCode: "StateConflict",
			})
		);
	});
});

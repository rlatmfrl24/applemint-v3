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
	it.each([
		["lookup", { url: "https://example.com/".padEnd(8192, "x") }, null],
		["savedLinks", { urls: ["https://example.com/".padEnd(8192, "x")] }, []],
	] as const)(
		"accepts %s query bodies while preserving owner checks",
		async (procedure, input, result) => {
			const context = createContext();
			const lookup = vi.fn().mockResolvedValue(result);
			context.services.bookmark = {
				[procedure]: lookup,
			} as unknown as TRPCContext["services"]["bookmark"];
			createContextMock.mockResolvedValue(context);
			const request = () =>
				new Request(`http://localhost/api/trpc/bookmark.${procedure}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input),
				});
			expect((await POST(request())).status).toBe(200);
			vi.mocked(context.getOwnerAccess).mockResolvedValue({
				kind: "forbidden",
				status: 403,
				message: "Owner only",
			});
			expect((await POST(request())).status).toBe(403);
			expect(lookup).toHaveBeenCalledTimes(1);
			expect(
				(
					await POST(
						new Request("http://localhost/api/trpc/thread.stats", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ state: "inbox" }),
						})
					)
				).status
			).toBe(405);
		}
	);
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

	it.each([
		["ECONNRESET", Object.assign(new Error("aborted"), { code: "ECONNRESET" })],
		["AbortError", new DOMException("aborted", "AbortError")],
	])("본문 읽기 중 %s로 끊어진 요청을 입력 오류로 기록하지 않는다", async (_name, cause) => {
		const context = createContext();
		createContextMock.mockResolvedValue(context);
		const controller = new AbortController();
		const init = {
			method: "POST",
			headers: { "content-type": "application/json" },
			duplex: "half",
			signal: controller.signal,
			body: new ReadableStream({
				pull(stream) {
					controller.abort();
					stream.error(cause);
				},
			}),
		};
		const response = await POST(
			new Request("http://localhost/api/trpc/bookmark.savedLinks?batch=1", init)
		);
		const body = await response.json();

		expect(response.status).toBe(499);
		expect(body[0].error.data.code).toBe("CLIENT_CLOSED_REQUEST");
		expect(console.error).not.toHaveBeenCalled();
		expect(console.info).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: "bookmark.savedLinks",
				outcome: "cancelled",
				errorCode: "CLIENT_CLOSED_REQUEST",
			})
		);
		expect(context.metrics.snapshot()).toMatchObject({ outcome: "cancelled", failureCount: 0 });
	});

	it("요청 신호가 취소됐더라도 잘못된 JSON은 400으로 보고한다", async () => {
		const context = createContext();
		createContextMock.mockResolvedValue(context);
		const response = await POST(
			new Request("http://localhost/api/trpc/bookmark.savedLinks?batch=1", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"0":',
				signal: AbortSignal.abort(),
			})
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body[0].error.data.code).toBe("BAD_REQUEST");
		expect(console.error).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: "bookmark.savedLinks",
				outcome: "rejected",
				errorCode: "BAD_REQUEST",
			})
		);
		expect(context.metrics.snapshot()).toMatchObject({ outcome: "rejected", failureCount: 1 });
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

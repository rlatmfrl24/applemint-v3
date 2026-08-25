import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/server/errors/domain-error";
import { RequestMetrics } from "@/server/observability/request-metrics";
import {
	crawlAlertsDashboard,
	crawlPolicySettings,
	crawlRunsBaseDashboard,
	threadRow,
} from "@/test/support/communication";
import type { TRPCContext } from "./context";
import { appRouter, createCaller } from "./router";

function createContext(
	access:
		| { kind: "owner"; claims?: { sub: string } }
		| { kind: "unauthenticated"; status: 401; message: string }
		| { kind: "forbidden"; status: 403; message: string }
		| { kind: "unavailable"; status: 503; message: string } = {
		kind: "owner",
		claims: { sub: "owner" },
	}
) {
	const services = {
		thread: {
			list: vi.fn().mockResolvedValue({
				items: [{ ...threadRow, id: "3" }],
				nextCursor: null,
			}),
			stats: vi.fn().mockResolvedValue({ counts: [], siteCounts: [], totalCount: 0 }),
			transition: vi.fn().mockResolvedValue({ ...threadRow, id: "3", state: "saved" }),
			bulkTrashInbox: vi.fn().mockResolvedValue({ movedCount: 2 }),
		},
		crawlPolicy: {
			get: vi.fn().mockResolvedValue(crawlPolicySettings),
			update: vi.fn().mockResolvedValue(crawlPolicySettings),
		},
		crawlRun: {
			getDashboard: vi.fn().mockResolvedValue({
				...crawlRunsBaseDashboard,
				...crawlAlertsDashboard,
			}),
		},
		push: {
			configuration: vi.fn().mockReturnValue({
				enabled: false,
				publicKey: null,
				reason: "disabled",
			}),
			subscribe: vi.fn().mockResolvedValue({ active: true }),
			status: vi.fn().mockResolvedValue({ active: true }),
			unsubscribe: vi.fn().mockResolvedValue({ disabled: true }),
			acknowledgeInbox: vi.fn().mockResolvedValue({
				acknowledged: true,
				acknowledgedAt: "2026-07-28T00:00:00.000Z",
			}),
			sendTest: vi.fn().mockResolvedValue({
				sent: true,
				sentAt: "2026-07-30T00:00:00.000Z",
			}),
		},
	};
	const getAuthenticatedAccess = vi.fn().mockResolvedValue({
		kind: "authenticated",
		claims: { sub: "owner" },
	});
	const getOwnerAccess = vi.fn().mockResolvedValue(access);
	const context = {
		requestId: "request-1",
		metrics: new RequestMetrics(),
		services: services as unknown as TRPCContext["services"],
		getAuthenticatedAccess,
		getOwnerAccess,
	} as unknown as TRPCContext;
	return { context, services, getAuthenticatedAccess, getOwnerAccess };
}

describe("AppRouter", () => {
	beforeEach(() => {
		vi.spyOn(console, "info").mockImplementation(() => undefined);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
	});

	it("문서화된 13개 procedure를 service에 연결한다", async () => {
		const { context, services } = createContext();
		const caller = createCaller(context);

		await caller.thread.list({ state: "inbox", limit: 24 });
		await caller.thread.stats({ state: "inbox" });
		await caller.thread.transition({
			id: "3",
			expectedState: "inbox",
			destinationState: "saved",
		});
		await caller.thread.bulkTrash();
		await caller.crawl.runs({ limit: 20, trendLimit: 20 });
		await caller.crawlPolicy.get();
		await caller.crawlPolicy.update({
			source: "arcalive",
			scheduleEnabled: false,
			cooldownSeconds: 3600,
			expectedUpdatedAt: "2026-07-22T12:00:00.000Z",
		});
		await caller.push.configuration();
		await caller.push.subscribe({
			endpoint: "https://push.test/device",
			expirationTime: null,
			keys: { p256dh: "A".repeat(43), auth: "B".repeat(22) },
		});
		await caller.push.status({ endpoint: "https://push.test/device" });
		await caller.push.unsubscribe({ endpoint: "https://push.test/device" });
		await caller.push.acknowledgeInbox({ endpoint: "https://push.test/device" });
		await caller.push.sendTest({ endpoint: "https://push.test/device" });

		expect(services.thread.list).toHaveBeenCalledOnce();
		expect(services.thread.stats).toHaveBeenCalledOnce();
		expect(services.thread.transition).toHaveBeenCalledOnce();
		expect(services.thread.bulkTrashInbox).toHaveBeenCalledOnce();
		expect(services.crawlRun.getDashboard).toHaveBeenCalledOnce();
		expect(services.crawlPolicy.get).toHaveBeenCalledOnce();
		expect(services.crawlPolicy.update).toHaveBeenCalledOnce();
		expect(services.push.configuration).toHaveBeenCalledOnce();
		expect(services.push.subscribe).toHaveBeenCalledOnce();
		expect(services.push.status).toHaveBeenCalledOnce();
		expect(services.push.unsubscribe).toHaveBeenCalledOnce();
		expect(services.push.acknowledgeInbox).toHaveBeenCalledOnce();
		expect(services.push.sendTest).toHaveBeenCalledOnce();
	});

	it("테스트 알림은 owner 검사에 실패하면 service를 호출하지 않는다", async () => {
		const { context, services } = createContext({
			kind: "forbidden",
			status: 403,
			message: "소유자만 접근할 수 있습니다.",
		});

		const error = await createCaller(context)
			.push.sendTest({ endpoint: "https://push.test/device" })
			.catch((caught) => caught);

		expect(error).toMatchObject({ code: "FORBIDDEN" });
		expect(services.push.sendTest).not.toHaveBeenCalled();
	});

	it("목록·통계는 claims만 확인하고 owner 사전 RPC를 생략한다", async () => {
		const { context, getAuthenticatedAccess, getOwnerAccess } = createContext();
		await createCaller(context).thread.stats({ state: "inbox" });
		expect(getAuthenticatedAccess).toHaveBeenCalledOnce();
		expect(getOwnerAccess).not.toHaveBeenCalled();
	});

	it("상태 변경과 관리 procedure는 기존 owner access를 확인한다", async () => {
		const { context, getAuthenticatedAccess, getOwnerAccess } = createContext();
		await createCaller(context).thread.transition({
			id: "3",
			expectedState: "inbox",
			destinationState: "saved",
		});
		expect(getOwnerAccess).toHaveBeenCalledOnce();
		expect(getAuthenticatedAccess).not.toHaveBeenCalled();
	});

	it.each([
		[
			{ kind: "unauthenticated", status: 401, message: "로그인이 필요합니다." } as const,
			"UNAUTHORIZED",
		],
		[
			{ kind: "forbidden", status: 403, message: "소유자만 접근할 수 있습니다." } as const,
			"FORBIDDEN",
		],
		[
			{ kind: "unavailable", status: 503, message: "권한을 확인할 수 없습니다." } as const,
			"SERVICE_UNAVAILABLE",
		],
	])("소유자 검사 실패를 %s로 변환한다", async (access, code) => {
		const { context } = createContext(access);
		const error = await createCaller(context)
			.thread.transition({
				id: "3",
				expectedState: "inbox",
				destinationState: "saved",
			})
			.catch((caught) => caught);
		expect(error).toBeInstanceOf(TRPCError);
		expect(error).toMatchObject({ code });
	});

	it.each([
		[
			{ kind: "unauthenticated", status: 401, message: "로그인이 필요합니다." } as const,
			"UNAUTHORIZED",
		],
		[
			{ kind: "unavailable", status: 503, message: "인증을 확인할 수 없습니다." } as const,
			"SERVICE_UNAVAILABLE",
		],
	])("읽기 claims 검사 실패를 %s로 변환한다", async (access, code) => {
		const { context } = createContext();
		context.getAuthenticatedAccess = vi.fn().mockResolvedValue(access);

		const error = await createCaller(context)
			.thread.list({ state: "inbox", limit: 24 })
			.catch((caught) => caught);

		expect(error).toBeInstanceOf(TRPCError);
		expect(error).toMatchObject({ code });
	});

	it("DB가 거부한 비소유자 읽기를 FORBIDDEN으로 보존한다", async () => {
		const { context, services } = createContext();
		services.thread.list.mockRejectedValue(
			new DomainError("Forbidden", "Applemint 소유자만 접근할 수 있습니다.")
		);

		const error = await createCaller(context)
			.thread.list({ state: "inbox", limit: 24 })
			.catch((caught) => caught);

		expect(error).toMatchObject({ code: "FORBIDDEN" });
	});

	it("잘못된 input을 service 호출 전에 BAD_REQUEST로 거부한다", async () => {
		const { context, services } = createContext();
		const error = await createCaller(context)
			.crawl.runs({ limit: 0, trendLimit: 20 })
			.catch((caught) => caught);
		expect(error).toMatchObject({ code: "BAD_REQUEST" });
		expect(services.crawlRun.getDashboard).not.toHaveBeenCalled();
	});

	it("domain conflict를 CONFLICT로 보존한다", async () => {
		const { context, services } = createContext();
		services.crawlPolicy.update.mockRejectedValue(
			new DomainError("StateConflict", "다른 화면에서 변경되었습니다.", {
				latestSettings: crawlPolicySettings,
			})
		);
		const error = await createCaller(context)
			.crawlPolicy.update({
				source: "arcalive",
				scheduleEnabled: false,
				cooldownSeconds: 3600,
				expectedUpdatedAt: "2026-07-22T12:00:00.000Z",
			})
			.catch((caught) => caught);
		expect(error).toMatchObject({
			code: "CONFLICT",
			cause: {
				code: "StateConflict",
				data: { latestSettings: crawlPolicySettings },
			},
		});
	});

	it("HTTP 오류 data에 정책 충돌의 최신 settings와 request ID를 포함한다", async () => {
		const { context, services } = createContext();
		services.crawlPolicy.update.mockRejectedValue(
			new DomainError("StateConflict", "다른 화면에서 변경되었습니다.", {
				latestSettings: crawlPolicySettings,
			})
		);
		const response = await fetchRequestHandler({
			endpoint: "/api/trpc",
			req: new Request("http://localhost/api/trpc/crawlPolicy.update", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					source: "arcalive",
					scheduleEnabled: false,
					cooldownSeconds: 3600,
					expectedUpdatedAt: "2026-07-22T12:00:00.000Z",
				}),
			}),
			router: appRouter,
			createContext: () => context,
		});
		const body = await response.json();

		expect(response.status).toBe(409);
		expect(body.error.data).toMatchObject({
			code: "CONFLICT",
			requestId: "request-1",
			latestSettings: crawlPolicySettings,
		});
	});

	it("service의 예상하지 못한 오류를 INTERNAL_SERVER_ERROR로 숨긴다", async () => {
		const { context, services } = createContext();
		services.thread.stats.mockRejectedValue(new Error("raw database details"));
		const error = await createCaller(context)
			.thread.stats({ state: "inbox" })
			.catch((caught) => caught);
		expect(error).toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "요청을 처리하지 못했습니다.",
		});
		expect(error.message).not.toContain("raw database details");
	});
});

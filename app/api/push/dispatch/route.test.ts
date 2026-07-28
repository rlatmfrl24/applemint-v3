import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createServiceRoleClientMock = vi.hoisted(() => vi.fn());
const runWebPushDispatcherMock = vi.hoisted(() => vi.fn());
const getConfigurationMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/service-role", () => ({
	createServiceRoleClient: createServiceRoleClientMock,
}));
vi.mock("../dispatcher", () => ({
	runWebPushDispatcher: runWebPushDispatcherMock,
}));
vi.mock("@/server/push/configuration", () => ({
	getWebPushServerConfiguration: getConfigurationMock,
}));

import { POST } from "./route";

const INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";
const enabledConfiguration = {
	enabled: true,
	public: { enabled: true, publicKey: "public-key", reason: null },
	publicKey: "public-key",
	privateKey: "private-key",
	subject: "mailto:owner@applemint.test",
};
const dispatchResult = {
	claimedCount: 1,
	deliveredCount: 1,
	retryCount: 0,
	invalidatedCount: 0,
	deadCount: 0,
	skippedCount: 0,
};

function request(secret = INTERNAL_SECRET, body: unknown = { limit: 20 }) {
	return new Request("http://localhost/api/push/dispatch", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-applemint-internal-secret": secret,
		},
		body: JSON.stringify(body),
	}) as NextRequest;
}

describe("POST /api/push/dispatch", () => {
	beforeEach(() => {
		vi.stubEnv("CRAWL_INTERNAL_SECRET", INTERNAL_SECRET);
		getConfigurationMock.mockReturnValue(enabledConfiguration);
		createServiceRoleClientMock.mockReturnValue({ kind: "service-role-client" });
		runWebPushDispatcherMock.mockResolvedValue(dispatchResult);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
	});

	afterEach(() => vi.unstubAllEnvs());

	it("internal secret을 fail closed로 검증한다", async () => {
		expect((await POST(request("wrong-secret"))).status).toBe(401);
		expect(runWebPushDispatcherMock).not.toHaveBeenCalled();

		vi.stubEnv("CRAWL_INTERNAL_SECRET", "");
		expect((await POST(request(""))).status).toBe(503);
		expect(runWebPushDispatcherMock).not.toHaveBeenCalled();
	});

	it("Web Push flag 또는 VAPID 설정이 중단되면 claim하지 않는다", async () => {
		for (const reason of ["disabled", "configuration-missing"]) {
			getConfigurationMock.mockReturnValueOnce({
				enabled: false,
				public: { enabled: false, publicKey: null, reason },
			});
			const response = await POST(request());
			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({ reason });
		}
		expect(createServiceRoleClientMock).not.toHaveBeenCalled();
		expect(runWebPushDispatcherMock).not.toHaveBeenCalled();
	});

	it("검증된 limit만 service-role dispatcher에 전달한다", async () => {
		const response = await POST(request(INTERNAL_SECRET, { limit: 7 }));
		expect(response.status).toBe(200);
		expect(runWebPushDispatcherMock).toHaveBeenCalledWith(
			createServiceRoleClientMock.mock.results[0].value,
			enabledConfiguration,
			7
		);
	});

	it("잘못된 JSON·추가 필드·범위 밖 limit을 실행 전에 거부한다", async () => {
		for (const body of [{ limit: 0 }, { limit: 21 }, { limit: 1.5 }, { limit: 1, extra: true }]) {
			expect((await POST(request(INTERNAL_SECRET, body))).status).toBe(400);
		}
		expect(runWebPushDispatcherMock).not.toHaveBeenCalled();
	});

	it("dispatcher 오류 메시지에서 endpoint와 암호화 키를 노출하지 않는다", async () => {
		runWebPushDispatcherMock.mockRejectedValueOnce(
			new Error("https://private.push.test secret-p256dh")
		);
		const response = await POST(request());

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "Web Push 발송을 처리하지 못했습니다.",
		});
	});
});

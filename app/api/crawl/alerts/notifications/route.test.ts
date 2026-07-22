import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const createServiceRoleClientMock = vi.hoisted(() => vi.fn(() => ({ rpc: rpcMock })));

vi.mock("@/utils/supabase/service-role", () => ({
	createServiceRoleClient: createServiceRoleClientMock,
}));

import { POST } from "./route";

const INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";

function request(body: unknown, secret = INTERNAL_SECRET) {
	return new Request("http://localhost/api/crawl/alerts/notifications", {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-applemint-internal-secret": secret },
		body: JSON.stringify(body),
	}) as NextRequest;
}

describe("POST /api/crawl/alerts/notifications", () => {
	beforeEach(() => {
		vi.stubEnv("CRAWL_INTERNAL_SECRET", INTERNAL_SECRET);
		rpcMock.mockReset();
		createServiceRoleClientMock.mockClear();
	});

	afterEach(() => vi.unstubAllEnvs());

	it("내부 secret과 요청 action을 검증한다", async () => {
		expect((await POST(request({ action: "list" }, "wrong"))).status).toBe(401);
		expect((await POST(request({ action: "complete", notificationId: "0" }))).status).toBe(400);
		expect(rpcMock).not.toHaveBeenCalled();
	});

	it("대기 중인 알림만 내부 API로 조회한다", async () => {
		const notifications = [{ id: "10", incidentId: "20", event: "opened" }];
		rpcMock.mockResolvedValue({ data: notifications, error: null });

		const response = await POST(request({ action: "list" }));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ notifications });
		expect(rpcMock).toHaveBeenCalledWith("get_pending_crawl_alert_notifications", {
			p_limit: 100,
		});
	});

	it("GitHub 전달 성공과 실패를 제한된 RPC로 기록한다", async () => {
		rpcMock.mockResolvedValue({ data: true, error: null });

		const completed = await POST(
			request({
				action: "complete",
				notificationId: "10",
				githubIssueNumber: 100,
				githubIssueUrl: "https://github.com/rlatmfrl24/applemint-v3/issues/100",
			})
		);
		const failed = await POST(
			request({ action: "fail", notificationId: "11", errorCode: "github_delivery_failed" })
		);

		expect(await completed.json()).toEqual({ completed: true });
		expect(await failed.json()).toEqual({ failed: true });
		expect(rpcMock).toHaveBeenNthCalledWith(1, "complete_crawl_alert_notification", {
			p_notification_id: "10",
			p_github_issue_number: 100,
			p_github_issue_url: "https://github.com/rlatmfrl24/applemint-v3/issues/100",
		});
		expect(rpcMock).toHaveBeenNthCalledWith(2, "fail_crawl_alert_notification", {
			p_notification_id: "11",
			p_error_code: "github_delivery_failed",
		});
	});

	it("DB 오류 상세를 노출하지 않는다", async () => {
		rpcMock.mockResolvedValue({ data: null, error: { message: "sensitive database error" } });

		const response = await POST(request({ action: "list", limit: 10 }));

		expect(response.status).toBe(500);
		expect(JSON.stringify(await response.json())).not.toContain("sensitive database error");
	});
});

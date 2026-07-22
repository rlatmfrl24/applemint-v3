import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/middleware", () => ({
	updateSession: updateSessionMock,
}));

import { proxy } from "./proxy";

describe("proxy", () => {
	beforeEach(() => {
		updateSessionMock.mockResolvedValue(NextResponse.next());
	});

	it.each([
		"/api/crawl",
		"/api/crawl/alerts/notifications",
		"/api/crawl/scheduled",
	])("내부 크롤링 API %s는 세션 proxy를 우회해 원본 요청 헤더를 보존한다", async (pathname) => {
		const request = new NextRequest(`http://localhost${pathname}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-applemint-internal-secret": "test-internal-secret",
			},
			body: JSON.stringify({ target: "arcalive" }),
		});

		const response = await proxy(request);

		expect(updateSessionMock).not.toHaveBeenCalled();
		expect(response.headers.get("x-middleware-override-headers")).toBeNull();
	});

	it("수동 크롤링 API는 로그인 세션 갱신을 유지한다", async () => {
		const request = new NextRequest("http://localhost/api/crawl/manual", {
			method: "POST",
		});

		await proxy(request);

		expect(updateSessionMock).toHaveBeenCalledWith(request);
	});
});

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

	it("예약 크롤링 API는 세션 proxy를 우회해 원본 요청 헤더를 보존한다", async () => {
		const pathname = "/api/crawl/scheduled";
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

	it("YouTube worker API는 Authorization, 내부 header와 JSON body를 보존한다", async () => {
		const request = new NextRequest("http://localhost/api/media/youtube/enrich", {
			method: "POST",
			headers: {
				Authorization: "Bearer fixture-authorization",
				"Content-Type": "application/json",
				"x-applemint-internal-secret": "test-internal-secret",
			},
			body: JSON.stringify({ limit: 7 }),
		});
		const bodyClone = request.clone();

		const response = await proxy(request);

		expect(updateSessionMock).not.toHaveBeenCalled();
		expect(response.headers.get("x-middleware-override-headers")).toBeNull();
		expect(request.headers.get("authorization")).toBe("Bearer fixture-authorization");
		expect(request.headers.get("x-applemint-internal-secret")).toBe("test-internal-secret");
		expect(await bodyClone.json()).toEqual({ limit: 7 });
	});

	it("Imgur worker API도 내부 header와 JSON body를 그대로 보존한다", async () => {
		const request = new NextRequest("http://localhost/api/media/imgur/enrich", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-applemint-internal-secret": "test-internal-secret",
			},
			body: JSON.stringify({ limit: 4 }),
		});
		const bodyClone = request.clone();

		const response = await proxy(request);

		expect(updateSessionMock).not.toHaveBeenCalled();
		expect(response.headers.get("x-middleware-override-headers")).toBeNull();
		expect(request.headers.get("x-applemint-internal-secret")).toBe("test-internal-secret");
		expect(await bodyClone.json()).toEqual({ limit: 4 });
	});

	it.each(["/api/push/dispatch", "/manifest.webmanifest", "/sw.js"])(
		"%s는 세션 갱신을 거치지 않는다",
		async (pathname) => {
			const request = new NextRequest(`http://localhost${pathname}`);

			await proxy(request);

			expect(updateSessionMock).not.toHaveBeenCalled();
		}
	);

	it("수동 크롤링 API는 로그인 세션 갱신을 유지한다", async () => {
		const request = new NextRequest("http://localhost/api/crawl/manual", {
			method: "POST",
		});

		await proxy(request);

		expect(updateSessionMock).toHaveBeenCalledWith(request);
	});
});

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createServerClientMock = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({ createServerClient: createServerClientMock }));

import { getAllowedRequestHeaders, updateSession } from "./middleware";

beforeEach(() => {
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
	createServerClientMock.mockReset();
	vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("getAllowedRequestHeaders", () => {
	it("JSON POST body 처리에 필요한 헤더를 세션 갱신 이후에도 보존한다", () => {
		const request = new NextRequest("http://localhost/api/crawl/manual", {
			method: "POST",
			headers: {
				"Content-Length": "22",
				"Content-Type": "application/json",
				Cookie: "session=test",
				"x-untrusted-header": "discard-me",
			},
			body: JSON.stringify({ target: "arcalive" }),
		});

		const headers = getAllowedRequestHeaders(request);

		expect(headers.get("content-length")).toBe("22");
		expect(headers.get("content-type")).toBe("application/json");
		expect(headers.get("cookie")).toBe("session=test");
		expect(headers.get("x-untrusted-header")).toBeNull();
	});
});

describe("updateSession", () => {
	it("getAll/setAll 쿠키와 캐시 방지 헤더를 요청·응답에 함께 반영한다", async () => {
		let readCookies: { name: string; value: string }[] = [];
		createServerClientMock.mockImplementation((_url, _key, options) => ({
			auth: {
				getClaims: vi.fn().mockImplementation(async () => {
					readCookies = options.cookies.getAll();
					options.cookies.setAll(
						[
							{
								name: "sb-session",
								value: "refreshed",
								options: { httpOnly: true, path: "/" },
							},
						],
						{
							"Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
							Expires: "0",
							Pragma: "no-cache",
						}
					);
					return { data: { claims: {} }, error: null };
				}),
			},
		}));
		const request = new NextRequest("http://localhost/main", {
			headers: { cookie: "sb-session=stale", "x-request-id": "safe-request-1" },
		});

		const response = await updateSession(request);

		expect(readCookies).toContainEqual({ name: "sb-session", value: "stale" });
		expect(request.cookies.get("sb-session")?.value).toBe("refreshed");
		expect(response.cookies.get("sb-session")?.value).toBe("refreshed");
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect(response.headers.get("pragma")).toBe("no-cache");
		expect(response.headers.get("x-request-id")).toBe("safe-request-1");
	});

	it("Auth 인프라 예외에도 허용 헤더와 no-store 응답을 유지한다", async () => {
		createServerClientMock.mockReturnValue({
			auth: { getClaims: vi.fn().mockRejectedValue(new Error("network unavailable")) },
		});

		const response = await updateSession(
			new NextRequest("http://localhost/main", {
				headers: { "x-untrusted-header": "discard-me" },
			})
		);

		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("x-middleware-request-x-untrusted-header")).toBeNull();
	});
});

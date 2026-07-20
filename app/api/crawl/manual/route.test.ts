import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({
	createClient: createClientMock,
}));

import { POST } from "./route";

const INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";
const ALLOWED_USER_ID = "11111111-1111-4111-8111-111111111111";

function createRequest(target: unknown) {
	return new Request("http://localhost/api/crawl/manual", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ target }),
	}) as NextRequest;
}

function mockUser(userId: string | null) {
	createClientMock.mockResolvedValue({
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: userId ? { id: userId } : null },
				error: null,
			}),
		},
	});
}

describe("POST /api/crawl/manual", () => {
	beforeEach(() => {
		vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
		vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
		vi.stubEnv("CRAWL_INTERNAL_SECRET", INTERNAL_SECRET);
		vi.stubEnv("CRAWL_ALLOWED_USER_IDS", ALLOWED_USER_ID);
		mockUser(ALLOWED_USER_ID);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("미로그인 사용자는 401을 반환한다", async () => {
		mockUser(null);

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(401);
	});

	it("허용목록 밖의 사용자는 403을 반환한다", async () => {
		mockUser("22222222-2222-4222-8222-222222222222");

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(403);
	});

	it("잘못된 target은 400을 반환한다", async () => {
		const response = await POST(createRequest("invalid"));

		expect(response.status).toBe(400);
	});

	it("허용목록 설정이 없거나 UUID 형식이 아니면 503으로 닫힌다", async () => {
		vi.stubEnv("CRAWL_ALLOWED_USER_IDS", "not-a-uuid");

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(503);
	});

	it("Edge의 409 상태와 구조화 응답을 그대로 전달한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: "already running" }), {
				status: 409,
				headers: { "Content-Type": "application/json" },
			})
		);
		vi.stubGlobal("fetch", fetchMock);

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "already running" });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://project.supabase.co/functions/v1/crawl-source",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"x-applemint-internal-secret": INTERNAL_SECRET,
				}),
			})
		);
	});

	it("Edge 요청 timeout은 504를 반환한다", async () => {
		const timeoutError = new Error("timed out");
		timeoutError.name = "TimeoutError";
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));

		const response = await POST(createRequest("arcalive"));

		expect(response.status).toBe(504);
	});
});

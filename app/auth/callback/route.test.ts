import { describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({ createClient: createClientMock }));

import { GET } from "./route";

describe("GET /auth/callback", () => {
	it("인증 코드를 교환하고 redirect 응답을 캐시하지 않는다", async () => {
		vi.spyOn(console, "info").mockImplementation(() => undefined);
		const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
		createClientMock.mockResolvedValue({ auth: { exchangeCodeForSession } });

		const response = await GET(
			new Request("http://localhost/auth/callback?code=authorization-code")
		);

		expect(exchangeCodeForSession).toHaveBeenCalledWith("authorization-code");
		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("http://localhost/main");
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect(response.headers.get("pragma")).toBe("no-cache");
		expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
		expect(console.info).toHaveBeenCalledWith(
			expect.objectContaining({
				transport: "auth-callback",
				authCallCount: 1,
				outcome: "succeeded",
			})
		);
	});
});

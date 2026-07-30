import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, createServerClientMock } = vi.hoisted(() => ({
	cookiesMock: vi.fn(),
	createServerClientMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@supabase/ssr", () => ({ createServerClient: createServerClientMock }));

import { createClient } from "./server";

beforeEach(() => {
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
	vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
	cookiesMock.mockReset();
	createServerClientMock.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("createClient", () => {
	it("Supabase가 전달한 쿠키 옵션을 Next.js cookie store에 그대로 반영한다", async () => {
		const cookieStore = {
			getAll: vi.fn().mockReturnValue([{ name: "sb-session", value: "stale" }]),
			set: vi.fn(),
		};
		let cookieMethods:
			| {
					getAll(): { name: string; value: string }[];
					setAll(
						cookies: {
							name: string;
							value: string;
							options: {
								httpOnly?: boolean;
								maxAge?: number;
								path?: string;
								sameSite?: boolean | "lax" | "strict" | "none";
							};
						}[]
					): void;
			  }
			| undefined;

		cookiesMock.mockResolvedValue(cookieStore);
		createServerClientMock.mockImplementation((_url, _key, options) => {
			cookieMethods = options.cookies;
			return { auth: {} };
		});

		await createClient();

		const options = {
			httpOnly: false,
			maxAge: 400 * 24 * 60 * 60,
			path: "/",
			sameSite: "lax" as const,
		};
		cookieMethods?.setAll([{ name: "sb-session", value: "refreshed", options }]);

		expect(cookieStore.set).toHaveBeenCalledWith("sb-session", "refreshed", options);
	});
});

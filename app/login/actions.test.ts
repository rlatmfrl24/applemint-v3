import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.hoisted(() =>
	vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	})
);
const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/utils/supabase/server", () => ({ createClient: createClientMock }));

import { signOutCurrentSession } from "./actions";

describe("signOutCurrentSession", () => {
	beforeEach(() => {
		redirectMock.mockClear();
		createClientMock.mockReset();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
	});

	it("현재 기기 세션만 로그아웃한 뒤 로그인 화면으로 이동한다", async () => {
		const signOut = vi.fn().mockResolvedValue({ error: null });
		createClientMock.mockResolvedValue({ auth: { signOut } });

		await expect(signOutCurrentSession()).rejects.toThrow("redirect:/login");

		expect(signOut).toHaveBeenCalledWith({ scope: "local" });
		expect(redirectMock).toHaveBeenCalledWith("/login");
	});

	it("로그아웃 실패 시 안전한 오류 코드만 기록하고 사용자에게 재시도를 안내한다", async () => {
		const signOut = vi.fn().mockResolvedValue({
			error: { code: "unexpected_failure", message: "sensitive upstream detail" },
		});
		createClientMock.mockResolvedValue({ auth: { signOut } });

		await expect(signOutCurrentSession()).rejects.toThrow("redirect:/login?message=");

		expect(console.error).toHaveBeenCalledWith({
			transport: "server-action",
			operation: "auth.signOut",
			outcome: "failed",
			errorCode: "unexpected_failure",
		});
		expect(console.error).not.toHaveBeenCalledWith(
			expect.objectContaining({ message: "sensitive upstream detail" })
		);
		expect(redirectMock).toHaveBeenCalledWith(
			`/login?message=${encodeURIComponent("로그아웃을 완료하지 못했습니다. 다시 시도해주세요.")}`
		);
	});
});

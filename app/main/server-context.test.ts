import { beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
	vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	})
);
const createClientMock = vi.hoisted(() => vi.fn());
const checkOwnerMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/utils/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/utils/supabase/owner-access", () => ({
	checkApplemintOwner: checkOwnerMock,
}));

import { createMainServerContext } from "./server-context";

describe("main server context", () => {
	beforeEach(() => {
		headersMock.mockReset();
		redirectMock.mockClear();
		createClientMock.mockReset();
		checkOwnerMock.mockReset();
		headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-rsc-1" }));
		createClientMock.mockResolvedValue({ rpc: vi.fn() });
	});

	it("검증된 소유자 claims와 services를 요청 컨텍스트로 만든다", async () => {
		checkOwnerMock.mockResolvedValue({
			kind: "owner",
			claims: { sub: "owner", email: "owner@example.com" },
		});

		const context = await createMainServerContext();

		expect(context).toMatchObject({
			requestId: "request-rsc-1",
			email: "owner@example.com",
			services: { thread: expect.anything() },
		});
		expect(createClientMock).toHaveBeenCalledOnce();
		expect(checkOwnerMock).toHaveBeenCalledWith(expect.anything(), context.metrics);
	});

	it.each([
		[{ kind: "unauthenticated", status: 401, message: "로그인이 필요합니다." }, "/login"],
		[
			{ kind: "forbidden", status: 403, message: "소유자만 접근할 수 있습니다." },
			`/login?message=${encodeURIComponent("소유자만 접근할 수 있습니다.")}`,
		],
	] as const)("인증 거부를 지정된 경로로 전달한다", async (access, path) => {
		checkOwnerMock.mockResolvedValue(access);

		await expect(createMainServerContext()).rejects.toThrow(`redirect:${path}`);
		expect(redirectMock).toHaveBeenCalledWith(path);
	});

	it("권한 확인 인프라 오류는 fail-closed 처리한다", async () => {
		checkOwnerMock.mockResolvedValue({
			kind: "unavailable",
			status: 503,
			message: "권한 확인 실패",
		});

		await expect(createMainServerContext()).rejects.toThrow("권한 확인 실패");
	});
});

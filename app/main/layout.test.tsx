import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
const checkOwnerMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
	vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	})
);

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/utils/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/utils/supabase/owner-access", () => ({ checkApplemintOwner: checkOwnerMock }));
vi.mock("../login/auth-button", () => ({ default: () => null }));
vi.mock("../nav-menu", () => ({ MainDrawer: () => null, NavMenu: () => null }));
vi.mock("./query-provider", () => ({
	MainQueryProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import MainLayout from "./layout";

describe("MainLayout 단일 소유자 접근", () => {
	beforeEach(() => {
		createClientMock.mockReset();
		checkOwnerMock.mockReset();
		redirectMock.mockClear();
		createClientMock.mockResolvedValue({});
	});

	it("소유자 확인 오류는 접근을 허용하지 않는다", async () => {
		checkOwnerMock.mockResolvedValue({ kind: "unavailable", message: "권한 확인 실패" });

		await expect(MainLayout({ children: null })).rejects.toThrow("권한 확인 실패");
	});

	it("소유자만 레이아웃을 렌더링한다", async () => {
		checkOwnerMock.mockResolvedValue({ kind: "owner" });

		await expect(MainLayout({ children: "content" })).resolves.toBeDefined();
	});
});

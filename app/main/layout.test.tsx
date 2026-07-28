import { beforeEach, describe, expect, it, vi } from "vitest";

const getMainServerContextMock = vi.hoisted(() => vi.fn());

vi.mock("../login/auth-button", () => ({ default: () => null }));
vi.mock("../nav-menu", () => ({ MainDrawer: () => null, NavMenu: () => null }));
vi.mock("./server-context", () => ({
	getMainServerContext: getMainServerContextMock,
}));
vi.mock("./query-provider", () => ({
	MainQueryProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import MainLayout from "./layout";

describe("MainLayout 단일 소유자 접근", () => {
	beforeEach(() => {
		getMainServerContextMock.mockReset();
	});

	it("소유자 확인 오류는 접근을 허용하지 않는다", async () => {
		getMainServerContextMock.mockRejectedValue(new Error("권한 확인 실패"));

		await expect(MainLayout({ children: null })).rejects.toThrow("권한 확인 실패");
	});

	it("소유자만 레이아웃을 렌더링한다", async () => {
		getMainServerContextMock.mockResolvedValue({ email: "owner@example.com" });

		await expect(MainLayout({ children: "content" })).resolves.toBeDefined();
		expect(getMainServerContextMock).toHaveBeenCalledOnce();
	});
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsNav } from "./settings-nav";

const navigationState = vi.hoisted(() => ({
	pathname: "/main/setting/crawling",
}));

vi.mock("next/navigation", () => ({
	usePathname: () => navigationState.pathname,
}));

describe("SettingsNav", () => {
	it("현재 설정 화면만 활성 메뉴로 표시한다", () => {
		navigationState.pathname = "/main/setting/operations";
		const html = renderToStaticMarkup(<SettingsNav />);

		expect(html).toMatch(/aria-current="page"[^>]*href="\/main\/setting\/operations"/u);
		expect(html.match(/aria-current="page"/gu)).toHaveLength(1);
		expect(html).toContain("수집 설정");
		expect(html).toContain("앱 및 알림");
		expect(html).toContain("데이터 관리");
	});

	it("태블릿 폭에서는 가로 탭을 유지하고 lg부터 세로 내비게이션으로 전환한다", () => {
		const html = renderToStaticMarkup(<SettingsNav />);

		expect(html).toContain("overflow-x-auto lg:overflow-visible");
		expect(html).toContain("lg:flex-col");
		expect(html).not.toContain("md:flex-col");
	});
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	getThreadListFilterParams,
	reconcileThreadFilterSelection,
	TypeStats,
} from "./thread-list";

const siteCounts = [{ siteKey: "fmkorea.com", label: "에펨코리아", count: 12 }];

describe("dynamic normal site filters", () => {
	it("site 선택을 normal 타입과 canonical site 조건으로 전달한다", () => {
		expect(getThreadListFilterParams({ kind: "site", siteKey: "fmkorea.com" })).toEqual([
			{ key: "filterType", value: "normal" },
			{ key: "filterSite", value: "fmkorea.com" },
		]);
	});

	it("선택 site가 임계값 아래로 사라지면 Normal 필터로 복구한다", () => {
		expect(reconcileThreadFilterSelection({ kind: "site", siteKey: "fmkorea.com" }, [])).toEqual({
			kind: "type",
			type: "normal",
		});
		expect(
			reconcileThreadFilterSelection({ kind: "site", siteKey: "fmkorea.com" }, siteCounts)
		).toEqual({ kind: "site", siteKey: "fmkorea.com" });
	});

	it("All, Normal, 나머지 타입, host 순서와 중복 없는 All 합계를 렌더링한다", () => {
		const html = renderToStaticMarkup(
			<TypeStats
				stats={{
					totalCount: 30,
					counts: [
						{ key: "youtube", label: "YouTube", count: 10 },
						{ key: "normal", label: "Normal", count: 8 },
					],
					siteCounts,
				}}
				selection={{ kind: "all" }}
				onSelectionChange={() => undefined}
			/>
		);

		expect(html.indexOf("All")).toBeLessThan(html.indexOf("Normal"));
		expect(html.indexOf("Normal")).toBeLessThan(html.indexOf("YouTube"));
		expect(html.indexOf("YouTube")).toBeLessThan(html.indexOf("에펨코리아"));
		expect(html).not.toContain("Host ·");
		expect(html).not.toContain("사이트 ·");
		expect(html).toContain(">30<");
		expect(html).not.toContain(">42<");
	});
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	getThreadListFilterParams,
	reconcileThreadFilterSelection,
	TypeStats,
} from "./thread-list";

const hostCounts = [{ host: "https://www.fmkorea.com/", label: "fmkorea.com", count: 12 }];

describe("dynamic normal host filters", () => {
	it("host 선택을 normal 타입과 원본 DB host 조건으로 전달한다", () => {
		expect(getThreadListFilterParams({ kind: "host", host: "https://www.fmkorea.com/" })).toEqual([
			{ key: "filterType", value: "normal" },
			{ key: "filterHost", value: "https://www.fmkorea.com/" },
		]);
	});

	it("선택 host가 임계값 아래로 사라지면 Normal 필터로 복구한다", () => {
		expect(
			reconcileThreadFilterSelection({ kind: "host", host: "https://www.fmkorea.com/" }, [])
		).toEqual({ kind: "type", type: "normal" });
		expect(
			reconcileThreadFilterSelection({ kind: "host", host: "https://www.fmkorea.com/" }, hostCounts)
		).toEqual({ kind: "host", host: "https://www.fmkorea.com/" });
	});

	it("All, Normal, 나머지 타입, host 순서와 중복 없는 All 합계를 렌더링한다", () => {
		const html = renderToStaticMarkup(
			<TypeStats
				stats={{
					totalCount: 30,
					counts: [
						{ key: "youtube", label: "YouTube", count: 10 },
						{ key: "normal", label: "Normal", count: 20 },
					],
					hostCounts,
				}}
				selection={{ kind: "all" }}
				onSelectionChange={() => undefined}
			/>
		);

		expect(html.indexOf("All")).toBeLessThan(html.indexOf("Normal"));
		expect(html.indexOf("Normal")).toBeLessThan(html.indexOf("YouTube"));
		expect(html.indexOf("YouTube")).toBeLessThan(html.indexOf("Host · fmkorea.com"));
		expect(html).toContain(">30<");
		expect(html).not.toContain(">42<");
	});
});

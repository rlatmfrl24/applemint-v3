import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataSummaryStrip, isBulkMoveDisabled, type NewThreadStats } from "./page";

const stats: NewThreadStats = {
	totalCount: 1234,
	counts: [
		{ key: "board", label: "게시판", count: 900 },
		{ key: "youtube", label: "YouTube", count: 300 },
		{ key: "imgur", label: "Imgur", count: 34 },
	],
};

describe("DataSummaryStrip", () => {
	it("전체 및 유형별 신규 글 통계를 연결형 요약으로 렌더링한다", () => {
		const html = renderToStaticMarkup(<DataSummaryStrip stats={stats} />);

		expect(html).toContain("전체 신규 글");
		expect(html).toContain('data-testid="new-thread-total-count"');
		expect(html).toContain("1,234개");
		expect(html).toContain("YouTube");
	});

	it("데이터가 없거나 작업 중이면 일괄 이동을 비활성화한다", () => {
		expect(isBulkMoveDisabled(undefined, false)).toBe(true);
		expect(isBulkMoveDisabled({ ...stats, totalCount: 0 }, false)).toBe(true);
		expect(isBulkMoveDisabled(stats, true)).toBe(true);
		expect(isBulkMoveDisabled(stats, false)).toBe(false);
	});
});

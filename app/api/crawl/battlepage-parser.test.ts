import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BATTLEPAGE_MINIMUM_ITEMS, parseBattlepageHtml } from "./battlepage-parser";

const currentFixture = readFileSync(
	new URL("./fixtures/battlepage-current.html", import.meta.url),
	"utf8"
);
const emptyFixture = readFileSync(
	new URL("./fixtures/battlepage-empty.html", import.meta.url),
	"utf8"
);

const battlepageRow = (href: string, title: string) => `
	<div class="bp_subject" title="${title}"><a href="${href}">${title}</a></div>
`;

describe("parseBattlepageHtml", () => {
	it("현재 실제 구조에서 최소 건수와 필수 필드를 추출한다", () => {
		const result = parseBattlepageHtml(currentFixture);

		expect(result.status).toBe("ok");
		expect(result.items).toHaveLength(BATTLEPAGE_MINIMUM_ITEMS);
		for (const item of result.items) {
			expect(item.url).toMatch(
				/^https:\/\/v12\.battlepage\.com\/\?\?=Board\.(?:Humor|Etc)\.View&no=\d+$/
			);
			expect(item.url).not.toContain("page=");
			expect(item.title?.trim()).toBeTruthy();
			expect(item.host).toBe("https://v12.battlepage.com");
			expect(item.tag).toEqual(["battlepage"]);
		}
	});

	it("실제 빈 페이지 marker를 empty warning으로 구분한다", () => {
		expect(parseBattlepageHtml(emptyFixture)).toMatchObject({
			status: "empty",
			items: [],
			warnings: [{ code: "empty-list", severity: "info", count: 0 }],
		});
	});

	it("page parameter 제거 후 중복 URL과 지원하지 않는 protocol을 제외한다", () => {
		const result = parseBattlepageHtml(`
			<div class="ListTable">
				${battlepageRow("/??=Board.Humor.View&page=1&no=10", "첫 게시물")}
				${battlepageRow("/??=Board.Humor.View&page=2&no=10", "중복 게시물")}
				${battlepageRow("ftp://v12.battlepage.com/??=Board.Humor.View&no=11", "지원하지 않는 링크")}
			</div>
		`);

		expect(result.items.map((item) => item.url)).toEqual([
			"https://v12.battlepage.com/??=Board.Humor.View&no=10",
		]);
		expect(result.discardedCount).toBe(1);
		expect(result.duplicateCount).toBe(1);
	});

	it("container 누락과 marker 없는 빈 구조를 parser failure로 처리한다", () => {
		expect(parseBattlepageHtml("<main>changed</main>")).toMatchObject({
			status: "failure",
			failure: { code: "missing-container" },
		});
		expect(parseBattlepageHtml('<div class="ListTable"></div>')).toMatchObject({
			status: "failure",
			failure: { code: "unrecognized-empty-state" },
		});
	});

	it("외부·손상 URL을 제외하고 모든 후보가 잘못되면 failure로 처리한다", () => {
		const result = parseBattlepageHtml(`
			<div class="ListTable">
				${battlepageRow("https://example.com/post/1", "외부 링크")}
				${battlepageRow("/??=Board.Unknown.View&no=1", "잘못된 게시판")}
			</div>
		`);

		expect(result).toMatchObject({
			status: "failure",
			warnings: [],
			candidateCount: 2,
			discardedCount: 2,
			failure: { code: "all-items-invalid" },
		});
	});

	it("최소 건수 미달과 일부 제외를 warning으로 반환한다", () => {
		const result = parseBattlepageHtml(`
			<div class="ListTable">
				${battlepageRow("/??=Board.Humor.View&page=2&no=10", "정상 게시물")}
				${battlepageRow("broken", "손상 URL")}
			</div>
		`);

		expect(result.status).toBe("ok");
		expect(result.items).toHaveLength(1);
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			"discarded-items",
			"below-minimum-items",
		]);
		expect(result.warnings.map((warning) => warning.severity)).toEqual(["info", "warning"]);
	});

	it("최소 후보 이상에서 절반 이상 제외되면 높은 제외율을 경고한다", () => {
		const result = parseBattlepageHtml(`
			<div class="ListTable">
				${battlepageRow("/??=Board.Etc.View&no=10", "정상 게시물")}
				${battlepageRow("broken-1", "손상 1")}
				${battlepageRow("broken-2", "손상 2")}
				${battlepageRow("broken-3", "손상 3")}
				${battlepageRow("broken-4", "손상 4")}
			</div>
		`);

		expect(result.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "high-discard-rate", severity: "warning", count: 4 }),
			])
		);
	});
});

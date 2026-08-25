import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOGDRIP_MINIMUM_ITEMS, parseDogdripHtml } from "./dogdrip-parser";

const currentFixture = readFileSync(
	new URL("./fixtures/dogdrip-popular-current.html", import.meta.url),
	"utf8"
);

const row = (id: number, title = `제목 ${id}`) =>
	`<li class="webzine"><a class="ed title-link" href="/dogdrip/${id}?sort_index=popular">${title}</a></li>`;

describe("parseDogdripHtml", () => {
	it("현재 인기글 구조에서 광고를 무시하고 canonical 게시물만 추출한다", () => {
		const result = parseDogdripHtml(currentFixture);

		expect(result).toMatchObject({
			status: "ok",
			candidateCount: 5,
			discardedCount: 2,
			ignoredCount: 1,
			duplicateCount: 1,
		});
		expect(result.items).toEqual([
			{
				url: "https://www.dogdrip.net/dogdrip/1001",
				title: "[인기] 정상 제목",
				description: "",
				host: "https://www.dogdrip.net",
				tag: ["dogdrip", "popular"],
			},
			{
				url: "https://www.dogdrip.net/dogdrip/1002",
				title: "두 번째 게시물",
				description: "",
				host: "https://www.dogdrip.net",
				tag: ["dogdrip", "popular"],
			},
		]);
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			"discarded-items",
			"below-minimum-items",
		]);
	});

	it("query와 fragment 제거 후 같은 게시물을 중복 제거한다", () => {
		const result = parseDogdripHtml(`
			<ul class="board-list">
				${row(1)}
				<li class="webzine"><a class="ed title-link" href="https://dogdrip.net/dogdrip/1?page=2#comment">중복</a></li>
			</ul>
		`);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.url).toBe("https://www.dogdrip.net/dogdrip/1");
		expect(result.duplicateCount).toBe(1);
	});

	it("악성 유사 도메인과 게시물 외 경로를 제외한다", () => {
		const result = parseDogdripHtml(`
			<ul class="board-list">
				${row(2)}
				<li class="webzine"><a class="ed title-link" href="https://dogdrip.net.evil.example/dogdrip/3">악성</a></li>
				<li class="webzine"><a class="ed title-link" href="/user/4">다른 경로</a></li>
			</ul>
		`);

		expect(result.items.map((item) => item.url)).toEqual(["https://www.dogdrip.net/dogdrip/2"]);
		expect(result.discardedCount).toBe(2);
	});

	it("목록 부재, 후보 부재, 모든 후보 무효를 parser failure로 처리한다", () => {
		expect(parseDogdripHtml("<main>changed</main>")).toMatchObject({
			status: "failure",
			failure: { code: "missing-container" },
		});
		expect(
			parseDogdripHtml('<ul class="board-list"><li class="webzine">광고</li></ul>')
		).toMatchObject({
			status: "failure",
			failure: { code: "unrecognized-empty-state" },
			ignoredCount: 1,
		});
		expect(
			parseDogdripHtml(
				'<ul class="board-list"><li class="webzine"><a class="ed title-link" href="https://evil.example/dogdrip/1">외부</a></li></ul>'
			)
		).toMatchObject({
			status: "failure",
			failure: { code: "all-items-invalid" },
		});
	});

	it("인기글 10건 이상이면 수집량 경고를 만들지 않는다", () => {
		const html = `<ul class="board-list">${Array.from(
			{ length: DOGDRIP_MINIMUM_ITEMS },
			(_value, index) => row(index + 1)
		).join("")}</ul>`;

		const result = parseDogdripHtml(html);

		expect(result.items).toHaveLength(DOGDRIP_MINIMUM_ITEMS);
		expect(result.warnings).toEqual([]);
	});
});

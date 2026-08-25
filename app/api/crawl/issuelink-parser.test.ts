import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ISSUELINK_MINIMUM_ITEMS, parseIssueLinkHtml } from "./issuelink-parser";

const currentFixture = readFileSync(
	new URL("./fixtures/issuelink-current.html", import.meta.url),
	"utf8"
);

const row = (source: string, id: number) =>
	`<a href="/community/go/${source}/${id}">제목 ${id} <small>[${id}]</small></a>`;

describe("parseIssueLinkHtml", () => {
	it("현재 구조에서 댓글 수만 제거하고 일반 대괄호 제목은 보존한다", () => {
		const result = parseIssueLinkHtml(currentFixture);

		expect(result).toMatchObject({
			status: "ok",
			candidateCount: 5,
			discardedCount: 1,
			duplicateCount: 1,
		});
		expect(result.items).toHaveLength(3);
		expect(result.items[0]).toEqual({
			url: "https://www.issuelink.co.kr/community/go/fmkorea/1001",
			title: "[공지] 정상 대괄호 제목",
			description: "",
			host: "https://www.fmkorea.com",
			tag: ["issuelink", "fmkorea"],
		});
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			"discarded-items",
			"below-minimum-items",
		]);
	});

	it("query와 fragment 제거 후 URL을 중복 제거한다", () => {
		const result = parseIssueLinkHtml(`
			${row("clien", 1)}
			<a href="https://issuelink.co.kr/community/go/clien/1?x=1#y">중복</a>
		`);

		expect(result.items).toHaveLength(1);
		expect(result.items[0].url).toBe("https://www.issuelink.co.kr/community/go/clien/1");
		expect(result.duplicateCount).toBe(1);
	});

	it("악성 유사 도메인을 제외하고 미등록 source key는 안전한 fallback으로 보존한다", () => {
		const result = parseIssueLinkHtml(`
			<a href="https://issuelink.co.kr.evil.example/community/go/fmkorea/1">악성 링크</a>
			<a href="/community/go/new-community/2">새 커뮤니티</a>
		`);

		expect(result.items).toEqual([
			expect.objectContaining({
				host: "https://www.issuelink.co.kr",
				tag: ["issuelink", "new-community"],
			}),
		]);
		expect(result.discardedCount).toBe(1);
	});

	it("목록 부재와 모든 후보 무효를 parser failure로 처리한다", () => {
		expect(parseIssueLinkHtml("<main>changed</main>")).toMatchObject({
			status: "failure",
			failure: { code: "missing-container" },
		});
		expect(
			parseIssueLinkHtml('<a href="https://evil.example/community/go/fmkorea/1">외부 링크</a>')
		).toMatchObject({
			status: "failure",
			failure: { code: "all-items-invalid" },
		});
	});

	it("50건 이상이면 최소 수집량 경고를 만들지 않는다", () => {
		const html = Array.from({ length: ISSUELINK_MINIMUM_ITEMS }, (_, index) =>
			row("fmkorea", index + 1)
		).join("");
		const result = parseIssueLinkHtml(html);

		expect(result.items).toHaveLength(ISSUELINK_MINIMUM_ITEMS);
		expect(result.warnings).toEqual([]);
	});
});

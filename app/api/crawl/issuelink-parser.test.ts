import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIssuelinkHtml } from "./issuelink-parser";

const currentFixture = readFileSync(
	new URL("./fixtures/issuelink-current.html", import.meta.url),
	"utf8"
);

describe("parseIssuelinkHtml", () => {
	it("표 순서와 무관하게 현재 community redirect 링크를 추출하고 중복을 제거한다", () => {
		const items = parseIssuelinkHtml(currentFixture);

		expect(items).toEqual([
			{
				url: "https://www.issuelink.co.kr/community/go/ppomppu/468400010045869",
				title: "첫 번째 게시물",
				description: "",
				host: "https://www.ppomppu.co.kr",
				tag: ["issuelink", "ppomppu"],
			},
			{
				url: "https://www.issuelink.co.kr/community/go/bobae/6956690",
				title: "두 번째 게시물",
				description: "",
				host: "https://www.bobaedream.co.kr",
				tag: ["issuelink", "bobae"],
			},
		]);
	});

	it("IssueLink 공식 호스트가 아닌 유사 도메인은 제외한다", () => {
		const items = parseIssuelinkHtml(`
			<a href="https://evilissuelink.co.kr/community/go/ppomppu/1">제외 대상</a>
		`);

		expect(items).toEqual([]);
	});
});

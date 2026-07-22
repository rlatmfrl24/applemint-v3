import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARCALIVE_MINIMUM_ITEMS, parseArcaliveHtml } from "./arcalive-parser";

const currentFixture = readFileSync(
	new URL("./fixtures/arcalive-current.html", import.meta.url),
	"utf8"
);

const arcaliveRow = (href: string, title: string) => `
	<a class="vrow column" href="${href}">
		<div class="vrow-inner"><div class="vrow-top"><span class="col-title">
			<span class="badges"><span class="badge">테스트</span></span>
			<span class="title">${title}</span>
		</span></div></div>
	</a>
`;

describe("parseArcaliveHtml", () => {
	it("현재 실제 구조에서 최소 건수와 필수 필드를 추출한다", () => {
		const result = parseArcaliveHtml(currentFixture);

		expect(result.status).toBe("ok");
		expect(result.items).toHaveLength(ARCALIVE_MINIMUM_ITEMS);
		expect(result.warnings).toEqual([]);
		expect(result.ignoredCount).toBe(2);
		for (const item of result.items) {
			expect(item.url).toMatch(/^https:\/\/arca\.live\/b\/iloveanimal\/\d+$/);
			expect(item.title?.trim()).toBeTruthy();
			expect(item.host).toBe("https://arca.live");
			expect(item.tag?.[0]).toBe("arcalive");
		}
	});

	it("pagination query와 hash를 canonical URL에서 제거한다", () => {
		const result = parseArcaliveHtml(currentFixture);

		expect(result.items.at(-1)?.url).toBe("https://arca.live/b/iloveanimal/1010");
	});

	it("canonical URL 중복과 지원하지 않는 protocol을 제외한다", () => {
		const result = parseArcaliveHtml(`
			<div class="list-table table">
				${arcaliveRow("/b/iloveanimal/1?p=1", "첫 게시물")}
				${arcaliveRow("https://arca.live/b/iloveanimal/1?p=2#comments", "중복 게시물")}
				${arcaliveRow("ftp://arca.live/b/iloveanimal/2", "지원하지 않는 링크")}
			</div>
		`);

		expect(result.items.map((item) => item.url)).toEqual(["https://arca.live/b/iloveanimal/1"]);
		expect(result.discardedCount).toBe(1);
		expect(result.duplicateCount).toBe(1);
	});

	it("공지와 필터링 행은 제외 진단 없이 무시한다", () => {
		const result = parseArcaliveHtml(`
			<div class="list-table table">
				<a class="vrow column notice" href="/b/iloveanimal/10"><span class="title">공지</span></a>
				<a class="vrow column filtered" href="/b/iloveanimal/11"><span class="title">필터링됨</span></a>
				${Array.from({ length: ARCALIVE_MINIMUM_ITEMS }, (_, index) =>
					arcaliveRow(`/b/iloveanimal/${index + 100}`, `정상 게시물 ${index + 1}`)
				).join("")}
			</div>
		`);

		expect(result).toMatchObject({
			status: "ok",
			ignoredCount: 2,
			discardedCount: 0,
			warnings: [],
		});
	});

	it("공식 빈 목록 표시는 empty warning으로 구분한다", () => {
		const result = parseArcaliveHtml(
			'<div class="list-table table"><div class="list-empty">게시물이 없습니다.</div></div>'
		);

		expect(result).toMatchObject({
			status: "empty",
			items: [],
			warnings: [{ code: "empty-list", severity: "info", count: 0 }],
		});
	});

	it("목록 container 누락과 인식할 수 없는 빈 구조를 failure로 구분한다", () => {
		expect(parseArcaliveHtml("<main>changed</main>")).toMatchObject({
			status: "failure",
			failure: { code: "missing-container" },
		});
		expect(parseArcaliveHtml('<div class="list-table table"></div>')).toMatchObject({
			status: "failure",
			failure: { code: "unrecognized-empty-state" },
		});
	});

	it("잘못된 URL만 존재하면 failure, 일부만 잘못되면 warning으로 처리한다", () => {
		const allInvalid = parseArcaliveHtml(`
			<div class="list-table table">
				${arcaliveRow("https://example.com/post/1", "외부 링크")}
			</div>
		`);
		expect(allInvalid).toMatchObject({
			status: "failure",
			warnings: [],
			failure: { code: "all-items-invalid" },
		});

		const partial = parseArcaliveHtml(`
			<div class="list-table table">
				${arcaliveRow("/b/iloveanimal/1?p=2", "정상 링크")}
				${arcaliveRow("not a url", "손상 링크")}
			</div>
		`);
		expect(partial.status).toBe("ok");
		expect(partial.items).toHaveLength(1);
		expect(partial.warnings.map((warning) => warning.code)).toEqual([
			"discarded-items",
			"below-minimum-items",
		]);
		expect(partial.warnings.map((warning) => warning.severity)).toEqual(["info", "warning"]);
	});
});

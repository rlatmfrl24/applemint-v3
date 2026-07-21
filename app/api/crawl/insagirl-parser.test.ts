import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSAGIRL_MINIMUM_ITEMS, parseInsagirlPayload } from "./insagirl-parser";

const currentFixture = JSON.parse(
	readFileSync(new URL("./fixtures/insagirl-current.json", import.meta.url), "utf8")
) as unknown;

describe("parseInsagirlPayload", () => {
	it("현재 실제 JSON 구조에서 최소 건수와 필수 필드를 추출한다", () => {
		const result = parseInsagirlPayload(currentFixture);

		expect(result.status).toBe("ok");
		expect(result.items).toHaveLength(INSAGIRL_MINIMUM_ITEMS);
		expect(result.warnings).toEqual([]);
		expect(result.ignoredCount).toBe(1);
		expect(result.duplicateCount).toBe(1);
		for (const item of result.items) {
			expect(item.url).toMatch(/^https?:\/\//);
			expect(item.title?.trim()).toBeTruthy();
			expect(item.host?.trim()).toBeTruthy();
			expect(item.tag).toEqual(["insagirl"]);
		}
		expect(new Set(result.items.map((item) => item.url)).size).toBe(result.items.length);
	});

	it("빈 배열과 syncwatch 전용 응답을 정상 empty로 구분한다", () => {
		expect(parseInsagirlPayload({ v: [] })).toMatchObject({
			status: "empty",
			warnings: [{ code: "empty-list", severity: "info" }],
		});
		expect(parseInsagirlPayload({ v: ["1|syncwatch|payload"] })).toMatchObject({
			status: "empty",
			warnings: [{ code: "empty-list", severity: "info" }],
		});
	});

	it("v 배열이 없는 구조 변경을 invalid-payload로 처리한다", () => {
		expect(parseInsagirlPayload({ items: [] })).toMatchObject({
			status: "failure",
			failure: { code: "invalid-payload" },
		});
		expect(parseInsagirlPayload("invalid")).toMatchObject({
			status: "failure",
			failure: { code: "invalid-payload" },
		});
	});

	it("제목 없는 URL 후보도 null title로 수집한다", () => {
		const result = parseInsagirlPayload({ v: ["1|tester|https://example.com/only-url"] });

		expect(result).toMatchObject({ status: "ok", candidateCount: 1, discardedCount: 0 });
		expect(result.items).toEqual([
			expect.objectContaining({ url: "https://example.com/only-url", title: null }),
		]);
	});

	it("일부 잘못된 후보는 제외하고 warning과 유효 항목을 보존한다", () => {
		const result = parseInsagirlPayload({
			v: [
				"1|tester|정상 제목 https://example.com/valid#fragment",
				"2|tester|https://example.com/only-url",
				42,
			],
		});

		expect(result.status).toBe("ok");
		expect(result.items).toEqual([
			expect.objectContaining({
				url: "https://example.com/valid",
				title: "정상 제목",
				host: "example.com",
			}),
			expect.objectContaining({
				url: "https://example.com/only-url",
				title: null,
			}),
		]);
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			"discarded-items",
			"below-minimum-items",
		]);
	});

	it("동일 URL은 제목이 있는 항목을 우선한다", () => {
		const result = parseInsagirlPayload({
			v: ["1|tester|https://example.com/same", "2|tester|복구된 제목 https://example.com/same"],
		});

		expect(result.items).toEqual([
			expect.objectContaining({ url: "https://example.com/same", title: "복구된 제목" }),
		]);
		expect(result.duplicateCount).toBe(1);
	});
});

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crawlArcalive } from "./arcalive";
import { crawlBattlepage } from "./battlepage";
import { crawlInsagirl } from "./insagirl";
import { crawlIssuelink } from "./issuelink";

const arcaliveFixture = readFileSync(
	new URL("./fixtures/arcalive-current.html", import.meta.url),
	"utf8"
);
const battlepageEmptyFixture = readFileSync(
	new URL("./fixtures/battlepage-empty.html", import.meta.url),
	"utf8"
);
const insagirlFixture = readFileSync(
	new URL("./fixtures/insagirl-current.json", import.meta.url),
	"utf8"
);
const issuelinkFixture = readFileSync(
	new URL("./fixtures/issuelink-current.html", import.meta.url),
	"utf8"
);

const htmlResponse = (body: string) =>
	new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
const jsonResponse = (body: string) =>
	new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });

describe("crawler parser adapters", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("Arcalive의 성공·empty·parser failure를 페이지별로 구분한다", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(htmlResponse(arcaliveFixture))
			.mockResolvedValueOnce(
				htmlResponse(
					'<div class="list-table table"><div class="list-empty">게시물이 없습니다.</div></div>'
				)
			)
			.mockResolvedValueOnce(htmlResponse("<main>changed</main>"));
		vi.stubGlobal("fetch", fetchMock);

		const result = await crawlArcalive();

		expect(result).toMatchObject({ attempted: 3, succeeded: 2 });
		expect(result.items).toHaveLength(10);
		expect(result.failures).toEqual([
			expect.objectContaining({ kind: "parser", message: expect.stringContaining("container") }),
		]);
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			"discarded-items",
			"empty-list",
		]);
	});

	it("Battlepage의 정상 empty 응답은 성공과 warning으로 집계한다", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(htmlResponse(battlepageEmptyFixture)))
		);

		const result = await crawlBattlepage();

		expect(result).toMatchObject({ attempted: 10, succeeded: 10, items: [], failures: [] });
		expect(result.warnings).toHaveLength(10);
		expect(result.warnings.every((warning) => warning.code === "empty-list")).toBe(true);
	});

	it("Insagirl 일부 parser failure가 다른 endpoint 결과를 폐기하지 않는다", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(insagirlFixture))
			.mockResolvedValueOnce(jsonResponse('{"items":[]}'));
		vi.stubGlobal("fetch", fetchMock);

		const result = await crawlInsagirl();

		expect(result).toMatchObject({ attempted: 2, succeeded: 1 });
		expect(result.items).toHaveLength(20);
		expect(result.failures).toEqual([
			expect.objectContaining({ kind: "parser", message: expect.stringContaining("v 배열") }),
		]);
		expect(result.warnings).toEqual([
			expect.objectContaining({ code: "discarded-items", count: 1 }),
		]);
	});

	it("Insagirl 손상 JSON을 network 오류가 아닌 parser failure로 분류한다", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse("{invalid"))
			.mockResolvedValueOnce(jsonResponse(insagirlFixture));
		vi.stubGlobal("fetch", fetchMock);

		const result = await crawlInsagirl();

		expect(result).toMatchObject({ attempted: 2, succeeded: 1 });
		expect(result.failures).toEqual([
			expect.objectContaining({ kind: "parser", message: expect.stringContaining("v 배열") }),
		]);
	});

	it("IssueLink 조건별 결과를 URL 기준으로 중복 제거한다", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(htmlResponse(issuelinkFixture)))
		);

		const result = await crawlIssuelink();

		expect(result).toMatchObject({ attempted: 3, succeeded: 3, failures: [], warnings: [] });
		expect(result.items).toHaveLength(2);
		expect(new Set(result.items.map((item) => item.url)).size).toBe(2);
	});

	it("IssueLink의 빈 비정상 문서는 parser failure로 분류한다", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(htmlResponse("<html><title>changed</title></html>")))
		);

		const result = await crawlIssuelink();

		expect(result).toMatchObject({ attempted: 3, succeeded: 0, items: [], warnings: [] });
		expect(result.failures).toHaveLength(3);
		expect(result.failures.every((failure) => failure.kind === "parser")).toBe(true);
	});

	it("HTTP·timeout 오류는 network failure로 유지한다", async () => {
		const timeout = new Error("timed out");
		timeout.name = "TimeoutError";
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));

		const result = await crawlArcalive();

		expect(result).toMatchObject({ attempted: 3, succeeded: 0, warnings: [] });
		expect(result.failures).toHaveLength(3);
		expect(result.failures[0]).toMatchObject({ kind: "network", timeout: true });
	});
});

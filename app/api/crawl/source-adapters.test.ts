import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crawlArcalive } from "./arcalive";
import { crawlBattlepage } from "./battlepage";
import { runCrawlerWithRetry } from "./crawl-runner";
import { crawlInsagirl } from "./insagirl";
import { crawlIssueLink, ISSUELINK_TARGET } from "./issuelink";

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
		expect(result.warnings.map((warning) => warning.code)).toEqual(["empty-list"]);
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
		expect(result.warnings).toEqual([]);
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

	it("IssueLink는 단일 고정 URL을 수집하고 parser 관측치를 남긴다", async () => {
		const fetchMock = vi.fn(() => Promise.resolve(htmlResponse(issuelinkFixture)));
		vi.stubGlobal("fetch", fetchMock);

		const result = await crawlIssueLink();

		expect(result).toMatchObject({ attempted: 1, succeeded: 1 });
		expect(result.items).toHaveLength(3);
		expect(result.parserObservations).toEqual([
			expect.objectContaining({ url: ISSUELINK_TARGET, status: "ok", validCount: 3 }),
		]);
		expect(fetchMock).toHaveBeenCalledWith(
			ISSUELINK_TARGET,
			expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) })
		);
	});

	it("IssueLink HTTP·timeout·parser failure를 올바른 failure 종류로 구분한다", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(new Response("bad", { status: 503 })))
		);
		expect(await crawlIssueLink()).toMatchObject({
			attempted: 1,
			succeeded: 0,
			failures: [
				expect.objectContaining({ kind: "network", message: expect.stringContaining("503") }),
			],
		});

		const timeout = new Error("timed out");
		timeout.name = "TimeoutError";
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));
		expect(await crawlIssueLink()).toMatchObject({
			failures: [expect.objectContaining({ kind: "network", timeout: true })],
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(htmlResponse("<main>changed</main>")))
		);
		expect(await crawlIssueLink()).toMatchObject({
			failures: [expect.objectContaining({ kind: "parser" })],
		});
	});

	it("IssueLink 단일 실패 URL만 선택 재시도해 결과를 복구한다", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("bad", { status: 503 }))
			.mockResolvedValueOnce(htmlResponse(issuelinkFixture));
		vi.stubGlobal("fetch", fetchMock);

		const result = await runCrawlerWithRetry("issuelink", crawlIssueLink, async () => {});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({
			retryCount: 1,
			recoveredCount: 1,
			failures: [],
			parserValidCount: 3,
		});
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

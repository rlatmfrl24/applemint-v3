import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crawlArcalive } from "./arcalive";
import { crawlBattlepage } from "./battlepage";
import { runCrawlerWithRetry } from "./crawl-runner";
import { crawlInsagirl } from "./insagirl";
import { crawlIssueLink, ISSUELINK_TARGET } from "./issuelink";

const arcaliveApiFixture = JSON.parse(
	readFileSync(new URL("./fixtures/arcalive-api-current.json", import.meta.url), "utf8")
) as {
	articles: Array<Record<string, unknown> & { id: number }>;
	next: Record<string, string>;
};
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

function arcaliveApiResponse(idOffset: number, next: Record<string, string> | null) {
	return jsonResponse(
		JSON.stringify({
			articles: arcaliveApiFixture.articles.map((article) => ({
				...article,
				id: article.id + idOffset,
			})),
			next,
		})
	);
}

describe("crawler parser adapters", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("Arcalive 앱 API cursor를 따라 3페이지를 수집하고 canonical URL로 변환한다", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				arcaliveApiResponse(0, { before: "2026-08-24T21:34:12.000Z", offset: "1" })
			)
			.mockResolvedValueOnce(
				arcaliveApiResponse(100, { before: "2026-08-24T10:46:11.000Z", offset: "1" })
			)
			.mockResolvedValueOnce(arcaliveApiResponse(200, null));
		vi.stubGlobal("fetch", fetchMock);

		const result = await crawlArcalive();

		expect(result).toMatchObject({ attempted: 3, succeeded: 3, failures: [], warnings: [] });
		expect(result.items).toHaveLength(30);
		expect(result.items[0]?.url).toBe("https://arca.live/b/iloveanimal/2001");
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining("/api/app/list/channel/iloveanimal?mode=best&limit=45"),
			expect.objectContaining({
				cache: "no-store",
				headers: expect.objectContaining({
					accept: "application/json",
					"user-agent": "net.umanle.arca.android/0.9.85",
					"x-device-token": expect.any(String),
				}),
			})
		);
		expect(fetchMock.mock.calls[1]?.[0]).toContain("before=2026-08-24T21%3A34%3A12.000Z");
	});

	it("Arcalive Cloudflare Challenge를 upstream-challenge로 기록하고 재시도하지 않는다", async () => {
		const fetchMock = vi.fn(() =>
			Promise.resolve(
				new Response('<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>', {
					status: 403,
					statusText: "Forbidden",
					headers: { server: "cloudflare", "cf-mitigated": "challenge" },
				})
			)
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await runCrawlerWithRetry("arcalive", crawlArcalive, async () => {});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ attempted: 1, succeeded: 0, retryCount: 0 });
		expect(result.failures).toEqual([
			expect.objectContaining({
				attempt: 1,
				kind: "upstream-challenge",
				message: "HTTP 403 Cloudflare Challenge",
			}),
		]);
	});

	it("Arcalive 선택 재시도 URL을 신뢰하지 않고 고정 API 시작점에서 순회한다", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(arcaliveApiResponse(0, null));
		vi.stubGlobal("fetch", fetchMock);

		await crawlArcalive({ urls: ["https://example.com/internal"] });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toMatch(
			/^https:\/\/arca\.live\/api\/app\/list\/channel\/iloveanimal\?/
		);
		expect(fetchMock.mock.calls[0]?.[0]).not.toContain("example.com");
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
		expect(ISSUELINK_TARGET).toContain("/community/listview/all/12/adj/");
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

		expect(result).toMatchObject({ attempted: 1, succeeded: 0, warnings: [] });
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatchObject({ kind: "network", timeout: true });
	});
});

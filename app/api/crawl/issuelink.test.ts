import { afterEach, describe, expect, it, vi } from "vitest";
import { runCrawlerWithRetry } from "./crawl-runner";
import { crawlIssueLink, ISSUELINK_TARGET } from "./issuelink";

const candidateUrl = (id: number) => `https://www.issuelink.co.kr/community/go/fmkorea/${id}`;
const listResponse = (count = 1) =>
	new Response(
		Array.from(
			{ length: count },
			(_, index) => `<a href="/community/go/source-${index}/${index + 1}">글 ${index + 1}</a>`
		).join("")
	);
const oneItemResponse = () => new Response('<a href="/community/go/fmkorea/1">원문 제목</a>');
const redirectResponse = (location: string, status = 307) =>
	new Response(null, { status, headers: { Location: location } });

afterEach(() => vi.unstubAllGlobals());

describe("crawlIssueLink original URLs", () => {
	it("사이트가 내부 목록으로 보내는 이전 커스텀 User-Agent를 사용하지 않는다", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				if (url === ISSUELINK_TARGET) return oneItemResponse();
				const userAgent = new Headers(init.headers).get("user-agent");
				return redirectResponse(
					userAgent?.includes("ApplemintCrawler")
						? "https://www.issuelink.co.kr/community/listview?elcode=fmkorea&elseq=1"
						: "https://www.fmkorea.com/1"
				);
			})
		);
		expect((await crawlIssueLink()).items).toEqual([
			expect.objectContaining({ url: "https://www.fmkorea.com/1", historyUrl: candidateUrl(1) }),
		]);
	});

	it.each([301, 302, 303, 307, 308])(
		"HTTP %i의 원문 주소를 저장하고 원문 페이지는 요청하지 않는다",
		async (status) => {
			const original = "http://www.fmkorea.com/1?mid=humor&document_srl=1#comment";
			const fetchMock = vi.fn(async (url: string) => {
				if (url === ISSUELINK_TARGET) return oneItemResponse();
				if (url === candidateUrl(1)) return redirectResponse(original, status);
				throw new Error(`Unexpected request: ${url}`);
			});
			vi.stubGlobal("fetch", fetchMock);

			const result = await crawlIssueLink();

			expect(result.items).toEqual([
				{
					url: original,
					historyUrl: candidateUrl(1),
					title: "원문 제목",
					description: "",
					host: "https://www.fmkorea.com",
					tag: ["issuelink", "fmkorea"],
				},
			]);
			expect(result).toMatchObject({ attempted: 1, succeeded: 1, failures: [] });
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(fetchMock).toHaveBeenLastCalledWith(
				candidateUrl(1),
				expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) })
			);
		}
	);

	it.each([
		"javascript:alert(1)",
		"https://user:password@www.fmkorea.com/1",
		"https://www.issuelink.co.kr/community/go/fmkorea/1",
		"https://other.issuelink.co.kr/1",
		"https://www.issuelink.co.kr./community/go/fmkorea/1",
		"/community/go/fmkorea/2",
		"http://[invalid",
	])("잘못된 Location %s를 게시물로 전달하지 않는다", async (location) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url === ISSUELINK_TARGET ? oneItemResponse() : redirectResponse(location)
			)
		);

		expect(await crawlIssueLink()).toMatchObject({
			items: [],
			succeeded: 0,
			failures: [expect.objectContaining({ url: candidateUrl(1), kind: "parser" })],
		});
	});

	it("Location 누락과 HTTP 오류를 각각 parser와 network 실패로 남긴다", async () => {
		for (const [response, kind] of [
			[new Response(null, { status: 307 }), "parser"],
			[new Response("bad", { status: 503 }), "network"],
		] as const) {
			vi.stubGlobal(
				"fetch",
				vi.fn(async (url: string) => (url === ISSUELINK_TARGET ? oneItemResponse() : response))
			);
			expect(await crawlIssueLink()).toMatchObject({
				items: [],
				failures: [expect.objectContaining({ url: candidateUrl(1), kind })],
			});
		}
	});

	it("실패 후보만 원래 제목과 태그로 재시도하고 정상 항목을 보존한다", async () => {
		let failedRequests = 0;
		const fetchMock = vi.fn(async (url: string) => {
			if (url === ISSUELINK_TARGET) {
				return new Response(
					'<a href="/community/go/fmkorea/1">첫 글</a><a href="/community/go/fmkorea/2">둘째 글</a>'
				);
			}
			if (url === candidateUrl(2) && failedRequests++ === 0) {
				throw new DOMException("timed out", "TimeoutError");
			}
			return redirectResponse(`https://www.fmkorea.com/${url.endsWith("/1") ? 1 : 2}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await runCrawlerWithRetry("issuelink", crawlIssueLink, async () => {});

		expect(result.items).toEqual([
			expect.objectContaining({ url: "https://www.fmkorea.com/1", title: "첫 글" }),
			expect.objectContaining({
				url: "https://www.fmkorea.com/2",
				title: "둘째 글",
				tag: ["issuelink", "fmkorea"],
			}),
		]);
		expect(result).toMatchObject({ failures: [], retryCount: 1, recoveredCount: 1 });
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			ISSUELINK_TARGET,
			candidateUrl(1),
			candidateUrl(2),
			candidateUrl(2),
		]);
	});

	it("재시도 후에도 실패한 원문은 제외하고 timeout을 유지한다", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url === ISSUELINK_TARGET) return oneItemResponse();
				throw new DOMException("timed out", "TimeoutError");
			})
		);

		expect(await runCrawlerWithRetry("issuelink", crawlIssueLink, async () => {})).toMatchObject({
			items: [],
			succeeded: 0,
			retryCount: 1,
			recoveredCount: 0,
			failures: [expect.objectContaining({ url: candidateUrl(1), timeout: true, attempt: 2 })],
		});
	});

	it("원문 주소가 같아도 서로 다른 수집 식별 주소를 보존한다", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) =>
				url === ISSUELINK_TARGET
					? new Response(
							'<a href="/community/go/fmkorea/1">첫 링크</a><a href="/community/go/fmkorea/2">다른 링크</a>'
						)
					: redirectResponse("https://www.fmkorea.com/shared")
			)
		);
		const result = await runCrawlerWithRetry("issuelink", crawlIssueLink, async () => {});
		expect(result.items.map((item) => item.historyUrl)).toEqual([candidateUrl(1), candidateUrl(2)]);
	});

	it("최대 4개 요청으로 인기순 후보를 처리하고 미등록 커뮤니티의 원문 host를 사용한다", async () => {
		let active = 0;
		let maximumActive = 0;
		const fetchMock = vi.fn(async (url: string) => {
			if (url === ISSUELINK_TARGET) return listResponse(25);
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active -= 1;
			return redirectResponse(`https://new-community.example/${url.split("/").at(-1)}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await crawlIssueLink();

		expect(maximumActive).toBe(4);
		expect(result.items).toHaveLength(20);
		expect(result.items.map((item) => item.url)).toEqual(
			Array.from({ length: 20 }, (_, index) => `https://new-community.example/${index + 1}`)
		);
		expect(result.items[0].host).toBe("https://new-community.example");
		expect(fetchMock).toHaveBeenCalledTimes(21);
	});

	it("취소 이후에는 새 원문 해석 요청을 보내지 않는다", async () => {
		const controller = new AbortController();
		const fetchMock = vi.fn(async () => {
			controller.abort(new DOMException("budget exceeded", "TimeoutError"));
			return oneItemResponse();
		});
		vi.stubGlobal("fetch", fetchMock);

		expect(await crawlIssueLink({ signal: controller.signal })).toMatchObject({
			items: [],
			succeeded: 0,
			failures: [expect.objectContaining({ timeout: true })],
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

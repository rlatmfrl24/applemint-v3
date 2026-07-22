import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crawlerMocks = vi.hoisted(() => ({
	arcalive: vi.fn(),
	battlepage: vi.fn(),
	insagirl: vi.fn(),
}));

vi.mock("./arcalive", () => ({ crawlArcalive: crawlerMocks.arcalive }));
vi.mock("./battlepage", () => ({ crawlBattlepage: crawlerMocks.battlepage }));
vi.mock("./insagirl", () => ({ crawlInsagirl: crawlerMocks.insagirl }));

import { POST } from "./route";

const INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";

function createRequest(target: unknown, secret = INTERNAL_SECRET) {
	return new Request("http://localhost/api/crawl", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-applemint-internal-secret": secret,
		},
		body: JSON.stringify({ target }),
	}) as NextRequest;
}

function createDefaultAdapterResult(retry: boolean) {
	if (retry) {
		return {
			items: [],
			attemptedUrls: ["https://example.com/2"],
			attempted: 1,
			succeeded: 0,
			failures: [
				{ url: "https://example.com/2", message: "selector changed", kind: "parser" as const },
			],
			warnings: [],
			parserObservations: [],
		};
	}
	return {
		items: [{ url: "https://example.com/1", title: "one", host: "example.com" }],
		attemptedUrls: ["https://example.com/1", "https://example.com/2"],
		attempted: 2,
		succeeded: 1,
		failures: [
			{ url: "https://example.com/2", message: "selector changed", kind: "parser" as const },
		],
		warnings: [
			{
				url: "https://example.com/1",
				code: "below-minimum-items" as const,
				severity: "warning" as const,
				message: "below minimum",
				count: 1,
			},
		],
		parserObservations: [
			{
				url: "https://example.com/1",
				status: "ok" as const,
				candidateCount: 1,
				validCount: 1,
				discardedCount: 0,
				ignoredCount: 0,
				duplicateCount: 0,
				minimumItems: 10,
			},
		],
	};
}

describe("POST /api/crawl", () => {
	beforeEach(() => {
		vi.stubEnv("CRAWL_INTERNAL_SECRET", INTERNAL_SECRET);
		crawlerMocks.arcalive.mockImplementation(async (options?: { urls?: string[] }) =>
			createDefaultAdapterResult(Array.isArray(options?.urls))
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it("올바른 내부 secret만 요청을 허용한다", async () => {
		const response = await POST(createRequest("arcalive", "wrong-secret"));

		expect(response.status).toBe(401);
		expect(crawlerMocks.arcalive).not.toHaveBeenCalled();
	});

	it("잘못된 target은 400을 반환한다", async () => {
		const response = await POST(createRequest("unknown"));

		expect(response.status).toBe(400);
	});

	it("제거된 IssueLink target은 400을 반환한다", async () => {
		const response = await POST(createRequest("issuelink"));

		expect(response.status).toBe(400);
	});

	it("일부 요청이 성공하면 warning을 포함한 결과를 반환한다", async () => {
		const response = await POST(createRequest("arcalive"));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toMatchObject({ target: "arcalive", attempted: 3, succeeded: 1 });
		expect(body).toMatchObject({ retryCount: 1, parserValidCount: 1, parserMinimumCount: 10 });
		expect(body.failures[0].attempt).toBe(2);
		expect(body.failures).toHaveLength(1);
		expect(body.warnings).toHaveLength(1);
		expect(crawlerMocks.arcalive).toHaveBeenCalledTimes(2);
		expect(crawlerMocks.arcalive).toHaveBeenLastCalledWith(
			expect.objectContaining({ urls: ["https://example.com/2"] })
		);
	});

	it("모든 요청이 parser failure이면 재시도 후 502를 반환한다", async () => {
		vi.useFakeTimers();
		crawlerMocks.arcalive.mockResolvedValue({
			items: [],
			attempted: 3,
			succeeded: 0,
			failures: [{ url: "https://example.com", message: "missing container", kind: "parser" }],
			warnings: [],
			parserObservations: [],
		});

		const responsePromise = POST(createRequest("arcalive"));
		await vi.runAllTimersAsync();
		const response = await responsePromise;

		expect(response.status).toBe(502);
		expect(crawlerMocks.arcalive).toHaveBeenCalledTimes(2);
	});

	it("모든 요청이 timeout이면 재시도 후 504를 반환한다", async () => {
		vi.useFakeTimers();
		crawlerMocks.arcalive.mockResolvedValue({
			items: [],
			attempted: 2,
			succeeded: 0,
			failures: [
				{
					url: "https://example.com",
					message: "timed out",
					kind: "network",
					timeout: true,
				},
			],
			warnings: [],
			parserObservations: [],
		});

		const responsePromise = POST(createRequest("arcalive"));
		await vi.runAllTimersAsync();
		const response = await responsePromise;

		expect(response.status).toBe(504);
		expect(crawlerMocks.arcalive).toHaveBeenCalledTimes(2);
	});

	it("timeout과 parser failure가 섞이면 502를 반환한다", async () => {
		vi.useFakeTimers();
		crawlerMocks.arcalive.mockResolvedValue({
			items: [],
			attempted: 2,
			succeeded: 0,
			failures: [
				{
					url: "https://example.com/timeout",
					message: "timed out",
					kind: "network",
					timeout: true,
				},
				{
					url: "https://example.com/parser",
					message: "missing container",
					kind: "parser",
				},
			],
			warnings: [],
			parserObservations: [],
		});

		const responsePromise = POST(createRequest("arcalive"));
		await vi.runAllTimersAsync();
		const response = await responsePromise;

		expect(response.status).toBe(502);
		expect(crawlerMocks.arcalive).toHaveBeenCalledTimes(2);
	});

	it("재시도로 복구된 실패를 제거하고 성공 결과를 합산한다", async () => {
		vi.useFakeTimers();
		crawlerMocks.arcalive
			.mockResolvedValueOnce({
				items: [],
				attemptedUrls: ["https://example.com/first"],
				attempted: 3,
				succeeded: 0,
				failures: [
					{ url: "https://example.com/first", message: "timeout", kind: "network", timeout: true },
				],
				warnings: [],
				parserObservations: [],
			})
			.mockResolvedValueOnce({
				items: [{ url: "https://example.com/ok", title: "ok", host: "example.com" }],
				attemptedUrls: ["https://example.com/first"],
				attempted: 1,
				succeeded: 1,
				failures: [],
				warnings: [],
				parserObservations: [
					{
						url: "https://example.com/first",
						status: "ok",
						candidateCount: 12,
						validCount: 12,
						discardedCount: 0,
						ignoredCount: 0,
						duplicateCount: 0,
						minimumItems: 10,
					},
				],
			});

		const responsePromise = POST(createRequest("arcalive"));
		await vi.runAllTimersAsync();
		const body = await (await responsePromise).json();

		expect(body).toMatchObject({
			attempted: 4,
			succeeded: 1,
			retryCount: 1,
			recoveredCount: 1,
		});
		expect(body.failures).toEqual([]);
		expect(body.parserObservations).toEqual([
			expect.objectContaining({ attempt: 2, validCount: 12 }),
		]);
	});
});

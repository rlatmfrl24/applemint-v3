import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crawlerMocks = vi.hoisted(() => ({
	arcalive: vi.fn(),
	battlepage: vi.fn(),
	insagirl: vi.fn(),
	issuelink: vi.fn(),
}));

vi.mock("./arcalive", () => ({ crawlArcalive: crawlerMocks.arcalive }));
vi.mock("./battlepage", () => ({ crawlBattlepage: crawlerMocks.battlepage }));
vi.mock("./insagirl", () => ({ crawlInsagirl: crawlerMocks.insagirl }));
vi.mock("./issuelink", () => ({ crawlIssuelink: crawlerMocks.issuelink }));

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

describe("POST /api/crawl", () => {
	beforeEach(() => {
		vi.stubEnv("CRAWL_INTERNAL_SECRET", INTERNAL_SECRET);
		crawlerMocks.arcalive.mockResolvedValue({
			items: [{ url: "https://example.com/1", title: "one", host: "example.com" }],
			attempted: 2,
			succeeded: 1,
			failures: [{ url: "https://example.com/2", message: "selector changed", kind: "parser" }],
			warnings: [
				{
					url: "https://example.com/1",
					code: "below-minimum-items",
					message: "below minimum",
					count: 1,
				},
			],
		});
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

	it("일부 요청이 성공하면 warning을 포함한 결과를 반환한다", async () => {
		const response = await POST(createRequest("arcalive"));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toMatchObject({ target: "arcalive", attempted: 2, succeeded: 1 });
		expect(body.failures).toHaveLength(1);
		expect(body.warnings).toHaveLength(1);
		expect(crawlerMocks.arcalive).toHaveBeenCalledTimes(1);
	});

	it("모든 요청이 parser failure이면 재시도 후 502를 반환한다", async () => {
		vi.useFakeTimers();
		crawlerMocks.arcalive.mockResolvedValue({
			items: [],
			attempted: 3,
			succeeded: 0,
			failures: [{ url: "https://example.com", message: "missing container", kind: "parser" }],
			warnings: [],
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
		});

		const responsePromise = POST(createRequest("arcalive"));
		await vi.runAllTimersAsync();
		const response = await responsePromise;

		expect(response.status).toBe(502);
		expect(crawlerMocks.arcalive).toHaveBeenCalledTimes(2);
	});
});

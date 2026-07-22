import { describe, expect, it, vi } from "vitest";
import { requestScheduledCrawl, runScheduledCrawls } from "./run.mjs";

const INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";

describe("crawler schedule runner", () => {
	it("capacity 응답만 30초 간격으로 다시 요청한다", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ reason: "capacity", retryAfterSeconds: 30 }), {
					status: 429,
				})
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ status: "succeeded" }), { status: 200 })
			);
		const delayMock = vi.fn().mockResolvedValue(undefined);

		await expect(
			requestScheduledCrawl("arcalive", {
				baseUrl: "https://example.com",
				internalSecret: INTERNAL_SECRET,
				fetchImplementation: fetchMock,
				delayImplementation: delayMock,
			})
		).resolves.toEqual({ status: "succeeded" });
		expect(delayMock).toHaveBeenCalledWith(30_000);
	});

	it("세 소스를 최대 두 worker로 처리한다", async () => {
		let active = 0;
		let maximum = 0;
		const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
			active += 1;
			maximum = Math.max(maximum, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active -= 1;
			return new Response(
				JSON.stringify({ status: "succeeded", target: JSON.parse(String(init?.body)).target }),
				{ status: 200 }
			);
		});

		const results = await runScheduledCrawls({
			baseUrl: "https://example.com/",
			internalSecret: INTERNAL_SECRET,
			fetchImplementation: fetchMock as typeof fetch,
			logger: { info: vi.fn() } as unknown as Console,
		});

		expect(maximum).toBe(2);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(results.map((result: { target: string }) => result.target)).toEqual([
			"arcalive",
			"battlepage",
			"insagirl",
		]);
	});
});

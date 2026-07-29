import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import albumFixture from "./fixtures/album.json";
import albumImagesFixture from "./fixtures/album-images.json";
import imageFixture from "./fixtures/image.json";
import { runImgurEnrichmentWorker } from "./worker";

function claimedJob(
	threadId: number,
	url: string,
	overrides: Partial<{ attempt_count: number; lease_token: string }> = {}
) {
	return {
		thread_id: threadId,
		provider: "imgur",
		url,
		attempt_count: overrides.attempt_count ?? 1,
		lease_token: overrides.lease_token ?? `imgur-lease-${threadId}`,
		lease_expires_at: "2026-07-27T01:00:00.000Z",
	};
}

function createQueueClient(
	jobs: ReturnType<typeof claimedJob>[],
	options: {
		rejectLifecycle?: boolean;
		rejectCooldown?: boolean;
		lifecycleError?: boolean;
	} = {}
) {
	const rpc = vi.fn(async (name: string) => {
		if (name === "claim_media_enrichment_jobs") return { data: jobs, error: null };
		if (name === "set_imgur_enrichment_cooldown") {
			return { data: !options.rejectCooldown, error: null };
		}
		if (options.lifecycleError) {
			return { data: null, error: { code: "fixture-rpc-error" } };
		}
		return { data: !options.rejectLifecycle, error: null };
	});
	return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function jsonResponse(value: unknown, headers: HeadersInit = {}) {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function successfulFetch() {
	return vi.fn(async (input: string | URL | Request) => {
		const pathname = new URL(String(input)).pathname;
		if (pathname === "/3/album/Album12") return jsonResponse(albumFixture);
		if (pathname === "/3/album/Album12/images") return jsonResponse(albumImagesFixture);
		if (pathname === "/3/image/Miss123") return new Response(null, { status: 404 });
		return jsonResponse(imageFixture);
	});
}

describe("runImgurEnrichmentWorker", () => {
	it("batch 2를 순차 처리하고 album의 실제 2-request 호출 수를 집계한다", async () => {
		const jobs = [
			claimedJob(1, "https://imgur.com/Img1234"),
			claimedJob(2, "https://imgur.com/a/Album12"),
		];
		const { client, rpc } = createQueueClient(jobs);
		const fetchImpl = successfulFetch();

		const result = await runImgurEnrichmentWorker(client, {
			clientId: "fixture-client-id",
			fetchImpl,
		});

		expect(result).toMatchObject({
			claimedCount: 2,
			readyCount: 2,
			unavailableCount: 0,
			retriedCount: 0,
			failedCount: 0,
			diagnostics: {
				providerOutcome: "completed",
				apiRequestCount: 3,
				rateLimitedCount: 0,
				errorCounts: {},
				httpStatusCounts: { "200": 3 },
			},
		});
		expect(rpc).toHaveBeenCalledWith("claim_media_enrichment_jobs", {
			p_provider: "imgur",
			p_limit: 2,
			p_lease_seconds: 60,
		});
		expect(rpc).toHaveBeenCalledWith(
			"complete_media_enrichment_job",
			expect.objectContaining({
				p_thread_id: 2,
				p_lease_token: "imgur-lease-2",
				p_metadata: expect.objectContaining({
					status: "ready",
					media_kind: "album",
					title: "설명으로 표시하는 앨범",
					media_count: 6,
				}),
			})
		);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(JSON.stringify(result)).not.toContain("fixture-client-id");
		expect(JSON.stringify(result)).not.toContain("https://imgur.com");
		expect(JSON.stringify(result)).not.toContain("data");
	});

	it("unsupported와 잘못된 ID는 API 호출 없이 서로 다른 종단 상태로 처리한다", async () => {
		const { client, rpc } = createQueueClient([
			claimedJob(5, "https://imgur.com/user/posts"),
			claimedJob(6, "https://imgur.com/bad-id"),
		]);
		const fetchImpl = successfulFetch();

		const result = await runImgurEnrichmentWorker(client, {
			clientId: "fixture-client-id",
			fetchImpl,
		});

		expect(result).toMatchObject({
			claimedCount: 2,
			unsupportedCount: 1,
			failedCount: 1,
			diagnostics: {
				providerOutcome: "partial",
				apiRequestCount: 0,
				errorCounts: { IMGUR_INVALID_ID: 1 },
			},
		});
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(rpc).toHaveBeenCalledWith("fail_media_enrichment_job", {
			p_thread_id: 6,
			p_lease_token: "imgur-lease-6",
			p_error_code: "IMGUR_INVALID_ID",
		});
	});

	it("404를 unavailable로 완료하고 안전한 HTTP 진단만 남긴다", async () => {
		const { client, rpc } = createQueueClient([claimedJob(7, "https://imgur.com/Miss123")]);

		const result = await runImgurEnrichmentWorker(client, {
			clientId: "fixture-client-id",
			fetchImpl: successfulFetch(),
		});

		expect(result).toMatchObject({
			unavailableCount: 1,
			diagnostics: {
				providerOutcome: "completed",
				apiRequestCount: 1,
				errorCounts: { IMGUR_HTTP_404: 1 },
				httpStatusCounts: { "404": 1 },
			},
		});
		expect(rpc).toHaveBeenCalledWith(
			"complete_media_enrichment_job",
			expect.objectContaining({
				p_thread_id: 7,
				p_metadata: expect.objectContaining({
					status: "unavailable",
					last_error_code: "IMGUR_HTTP_404",
				}),
			})
		);
	});

	it.each([
		{
			name: "HTTP 5xx",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
			errorCode: "IMGUR_HTTP_5XX",
			httpStatusCounts: { "503": 1 },
		},
		{
			name: "timeout",
			fetchImpl: vi.fn().mockRejectedValue(new DOMException("fixture timeout", "TimeoutError")),
			errorCode: "IMGUR_TIMEOUT",
			httpStatusCounts: {},
		},
		{
			name: "network",
			fetchImpl: vi.fn().mockRejectedValue(new TypeError("fixture network")),
			errorCode: "IMGUR_NETWORK",
			httpStatusCounts: {},
		},
		{
			name: "invalid response",
			fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ unexpected: true })),
			errorCode: "IMGUR_INVALID_RESPONSE",
			httpStatusCounts: { "200": 1 },
		},
	])(
		"$name를 지수 backoff retry와 실제 오류 코드로 보존한다",
		async ({ fetchImpl, errorCode, httpStatusCounts }) => {
			const { client, rpc } = createQueueClient([claimedJob(10, "https://imgur.com/Img1234")]);

			const result = await runImgurEnrichmentWorker(client, {
				clientId: "fixture-client-id",
				fetchImpl,
				now: () => new Date("2026-07-27T00:00:00.000Z"),
			});

			expect(result).toMatchObject({
				retriedCount: 1,
				diagnostics: {
					providerOutcome: "retrying",
					apiRequestCount: 1,
					errorCounts: { [errorCode]: 1 },
					httpStatusCounts,
					nextAvailableAt: "2026-07-27T00:01:00.000Z",
				},
			});
			expect(rpc).toHaveBeenCalledWith("retry_media_enrichment_job", {
				p_thread_id: 10,
				p_lease_token: "imgur-lease-10",
				p_error_code: errorCode,
				p_available_at: "2026-07-27T00:01:00.000Z",
			});
		}
	);

	it("첫 429 뒤 남은 claimed job을 네트워크 없이 동일 cooldown으로 retry한다", async () => {
		const { client, rpc } = createQueueClient([
			claimedJob(11, "https://imgur.com/Img1234", { attempt_count: 5 }),
			claimedJob(12, "https://imgur.com/Img5678", { attempt_count: 5 }),
		]);
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 429,
				headers: { "Retry-After": "120" },
			})
		);

		const result = await runImgurEnrichmentWorker(client, {
			clientId: "fixture-client-id",
			fetchImpl,
			now: () => new Date("2026-07-27T00:00:00.000Z"),
		});

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			retriedCount: 2,
			failedCount: 0,
			diagnostics: {
				providerOutcome: "rate-limited",
				apiRequestCount: 1,
				rateLimitedCount: 2,
				errorCounts: { IMGUR_HTTP_429: 2 },
				httpStatusCounts: { "429": 1 },
				nextAvailableAt: "2026-07-27T00:02:00.000Z",
				cooldownUntil: "2026-07-27T00:02:00.000Z",
			},
		});
		expect(rpc).toHaveBeenCalledWith("set_imgur_enrichment_cooldown", {
			p_until: "2026-07-27T00:02:00.000Z",
			p_error_code: "IMGUR_HTTP_429",
		});
		expect(rpc).toHaveBeenCalledWith(
			"retry_media_enrichment_job",
			expect.objectContaining({
				p_thread_id: 12,
				p_error_code: "IMGUR_HTTP_429",
				p_available_at: "2026-07-27T00:02:00.000Z",
			})
		);
	});

	it("성공 응답 remaining 0은 현재 건을 완료하고 나머지를 cooldown retry한다", async () => {
		const { client } = createQueueClient([
			claimedJob(13, "https://imgur.com/Img1234"),
			claimedJob(14, "https://imgur.com/Img5678"),
		]);
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(jsonResponse(imageFixture, { "X-RateLimit-ClientRemaining": "0" }));

		const result = await runImgurEnrichmentWorker(client, {
			clientId: "fixture-client-id",
			fetchImpl,
			now: () => new Date("2026-07-27T00:00:00.000Z"),
		});

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			readyCount: 1,
			retriedCount: 1,
			diagnostics: {
				providerOutcome: "rate-limited",
				apiRequestCount: 1,
				rateLimitedCount: 2,
				errorCounts: { IMGUR_CLIENT_QUOTA_EXHAUSTED: 2 },
				cooldownUntil: "2026-07-28T01:00:00.000Z",
				rateLimit: { clientRemaining: 0 },
			},
		});
	});

	it("quota 없는 403과 최대 transient 시도는 실제 오류 코드로 종단 처리한다", async () => {
		const forbidden = createQueueClient([claimedJob(20, "https://imgur.com/Img1234")]);
		const forbiddenResult = await runImgurEnrichmentWorker(forbidden.client, {
			clientId: "fixture-client-id",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
		});
		expect(forbiddenResult).toMatchObject({
			failedCount: 1,
			diagnostics: { providerOutcome: "failed", errorCounts: { IMGUR_HTTP_403: 1 } },
		});

		const exhausted = createQueueClient([
			claimedJob(21, "https://imgur.com/Img1234", { attempt_count: 5 }),
		]);
		const exhaustedResult = await runImgurEnrichmentWorker(exhausted.client, {
			clientId: "fixture-client-id",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
		});
		expect(exhaustedResult).toMatchObject({
			retriedCount: 0,
			failedCount: 1,
			diagnostics: { providerOutcome: "failed", errorCounts: { IMGUR_HTTP_5XX: 1 } },
		});
		expect(exhausted.rpc).toHaveBeenCalledWith("fail_media_enrichment_job", {
			p_thread_id: 21,
			p_lease_token: "imgur-lease-21",
			p_error_code: "IMGUR_HTTP_5XX",
		});
	});

	it("lease token 거부는 성공 카운터 대신 leaseRejectedCount에 반영한다", async () => {
		const rejected = createQueueClient([claimedJob(22, "https://imgur.com/Img1234")], {
			rejectLifecycle: true,
		});
		const result = await runImgurEnrichmentWorker(rejected.client, {
			clientId: "fixture-client-id",
			fetchImpl: successfulFetch(),
		});
		expect(result).toMatchObject({
			readyCount: 0,
			leaseRejectedCount: 1,
			diagnostics: { providerOutcome: "partial" },
		});
	});

	it("queue lifecycle RPC 오류를 provider network retry로 오인하지 않는다", async () => {
		const queueFailure = createQueueClient([claimedJob(23, "https://imgur.com/Img1234")], {
			lifecycleError: true,
		});

		await expect(
			runImgurEnrichmentWorker(queueFailure.client, {
				clientId: "fixture-client-id",
				fetchImpl: successfulFetch(),
			})
		).rejects.toMatchObject({ code: "IMGUR_QUEUE_RPC_FAILED" });
		expect(
			queueFailure.rpc.mock.calls.filter(([name]) => name === "retry_media_enrichment_job")
		).toHaveLength(0);
	});

	it("Imgur 요청 concurrency를 1로 고정하고 batch 2를 넘기지 않는다", async () => {
		const jobs = [
			claimedJob(30, "https://imgur.com/Img120"),
			claimedJob(31, "https://imgur.com/Img121"),
		];
		const { client } = createQueueClient(jobs);
		let activeCount = 0;
		let maximumActiveCount = 0;
		const fetchImpl = vi.fn(async () => {
			activeCount += 1;
			maximumActiveCount = Math.max(maximumActiveCount, activeCount);
			await new Promise((resolve) => setTimeout(resolve, 5));
			activeCount -= 1;
			return jsonResponse(imageFixture);
		});

		const result = await runImgurEnrichmentWorker(client, {
			clientId: "fixture-client-id",
			fetchImpl,
		});
		expect(result.readyCount).toBe(2);
		expect(maximumActiveCount).toBe(1);
		await expect(
			runImgurEnrichmentWorker(client, {
				clientId: "fixture-client-id",
				concurrency: 2,
				fetchImpl,
			})
		).rejects.toMatchObject({ code: "IMGUR_INVALID_CONCURRENCY" });
	});

	it("claim 응답이 limit보다 많거나 cooldown RPC가 실패하면 안전하게 중단한다", async () => {
		const tooMany = createQueueClient([
			claimedJob(40, "https://imgur.com/Img120"),
			claimedJob(41, "https://imgur.com/Img121"),
		]);
		const fetchImpl = successfulFetch();
		await expect(
			runImgurEnrichmentWorker(tooMany.client, {
				clientId: "fixture-client-id",
				limit: 1,
				fetchImpl,
			})
		).rejects.toMatchObject({ code: "IMGUR_INVALID_CLAIM_RESPONSE" });
		expect(fetchImpl).not.toHaveBeenCalled();

		const cooldownFailure = createQueueClient([claimedJob(42, "https://imgur.com/Img1234")], {
			rejectCooldown: true,
		});
		await expect(
			runImgurEnrichmentWorker(cooldownFailure.client, {
				clientId: "fixture-client-id",
				fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
			})
		).rejects.toMatchObject({ code: "IMGUR_COOLDOWN_RPC_FAILED" });
	});

	it("Client-ID가 비어 있으면 queue를 claim하지 않는다", async () => {
		const { client, rpc } = createQueueClient([]);

		await expect(
			runImgurEnrichmentWorker(client, { clientId: " ", fetchImpl: vi.fn() })
		).rejects.toMatchObject({ code: "IMGUR_CLIENT_ID_MISSING" });
		expect(rpc).not.toHaveBeenCalled();
	});
});

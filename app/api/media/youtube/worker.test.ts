import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/videos-list-success.json";
import { runYouTubeEnrichmentWorker } from "./worker";

function claimedJob(
	threadId: number,
	url: string,
	overrides: Partial<{
		attempt_count: number;
		lease_token: string;
	}> = {}
) {
	return {
		thread_id: threadId,
		provider: "youtube",
		url,
		attempt_count: overrides.attempt_count ?? 1,
		lease_token: overrides.lease_token ?? `lease-${threadId}`,
		lease_expires_at: "2026-07-27T01:00:00.000Z",
	};
}

function createQueueClient(
	jobs: ReturnType<typeof claimedJob>[],
	options: { rejectLifecycle?: boolean } = {}
) {
	const rpc = vi.fn(async (name: string) => {
		if (name === "claim_media_enrichment_jobs") {
			return { data: jobs, error: null };
		}
		return { data: !options.rejectLifecycle, error: null };
	});
	return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function successfulFetch(items = fixture.items) {
	return vi.fn().mockResolvedValue(new Response(JSON.stringify({ items }), { status: 200 }));
}

describe("runYouTubeEnrichmentWorker", () => {
	it("중복 ID batch를 한 번 조회하고 ready, unavailable, unsupported를 lease별로 완료한다", async () => {
		const jobs = [
			claimedJob(1, "https://www.youtube.com/watch?v=abcDEF12345"),
			claimedJob(2, "https://www.youtube.com/shorts/abcDEF12345"),
			claimedJob(3, "https://www.youtube.com/watch?v=liveABC1234"),
			claimedJob(4, "https://www.youtube.com/watch?v=soonABC1234"),
			claimedJob(5, "https://www.youtube.com/watch?v=missABC1234"),
			claimedJob(6, "https://www.youtube.com/channel/UC123"),
			claimedJob(7, "https://www.youtube.com/watch?v=bad"),
		];
		const { client, rpc } = createQueueClient(jobs);
		const fetchMock = successfulFetch();

		const result = await runYouTubeEnrichmentWorker(client, {
			apiKey: "fixture-api-key",
			fetchImpl: fetchMock,
		});

		expect(result).toEqual({
			claimedCount: 7,
			readyCount: 4,
			unavailableCount: 1,
			unsupportedCount: 1,
			retriedCount: 0,
			failedCount: 1,
			leaseRejectedCount: 0,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
		expect(requestUrl.searchParams.get("id")).toBe(
			"abcDEF12345,liveABC1234,soonABC1234,missABC1234"
		);
		expect(rpc).toHaveBeenCalledWith("claim_media_enrichment_jobs", {
			p_provider: "youtube",
			p_limit: 50,
			p_lease_seconds: 45,
		});
		expect(rpc).toHaveBeenCalledWith(
			"complete_media_enrichment_job",
			expect.objectContaining({
				p_thread_id: 2,
				p_lease_token: "lease-2",
				p_metadata: expect.objectContaining({
					status: "ready",
					media_kind: "short",
					duration_seconds: 125,
				}),
			})
		);
		expect(rpc).toHaveBeenCalledWith(
			"complete_media_enrichment_job",
			expect.objectContaining({
				p_thread_id: 3,
				p_lease_token: "lease-3",
				p_metadata: expect.objectContaining({
					status: "ready",
					media_kind: "live",
					live_status: "live",
				}),
			})
		);
		expect(rpc).toHaveBeenCalledWith(
			"complete_media_enrichment_job",
			expect.objectContaining({
				p_thread_id: 4,
				p_lease_token: "lease-4",
				p_metadata: expect.objectContaining({
					status: "ready",
					media_kind: "live",
					live_status: "upcoming",
				}),
			})
		);
		expect(rpc).toHaveBeenCalledWith(
			"complete_media_enrichment_job",
			expect.objectContaining({
				p_thread_id: 5,
				p_lease_token: "lease-5",
				p_metadata: expect.objectContaining({
					status: "unavailable",
					last_error_code: "YOUTUBE_NOT_RETURNED",
					title: null,
				}),
			})
		);
		expect(rpc).toHaveBeenCalledWith(
			"complete_media_enrichment_job",
			expect.objectContaining({
				p_thread_id: 6,
				p_lease_token: "lease-6",
				p_metadata: expect.objectContaining({
					status: "unsupported",
					last_error_code: "YOUTUBE_UNSUPPORTED_URL",
				}),
			})
		);
		expect(rpc).toHaveBeenCalledWith("fail_media_enrichment_job", {
			p_thread_id: 7,
			p_lease_token: "lease-7",
			p_error_code: "YOUTUBE_INVALID_VIDEO_ID",
		});
	});

	it.each([
		{
			name: "HTTP 429",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
			errorCode: "YOUTUBE_HTTP_429",
		},
		{
			name: "HTTP 5xx",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
			errorCode: "YOUTUBE_HTTP_5XX",
		},
		{
			name: "timeout",
			fetchImpl: vi.fn().mockRejectedValue(new DOMException("fixture timeout", "TimeoutError")),
			errorCode: "YOUTUBE_TIMEOUT",
		},
		{
			name: "network error",
			fetchImpl: vi.fn().mockRejectedValue(new TypeError("fixture network failure")),
			errorCode: "YOUTUBE_NETWORK",
		},
	])("$name를 durable retry와 available_at으로 보존한다", async ({ fetchImpl, errorCode }) => {
		const { client, rpc } = createQueueClient([
			claimedJob(10, "https://www.youtube.com/watch?v=abcDEF12345"),
		]);

		const result = await runYouTubeEnrichmentWorker(client, {
			apiKey: "fixture-api-key",
			fetchImpl,
			now: () => new Date("2026-07-27T00:00:00.000Z"),
		});

		expect(result.retriedCount).toBe(1);
		expect(rpc).toHaveBeenCalledWith("retry_media_enrichment_job", {
			p_thread_id: 10,
			p_lease_token: "lease-10",
			p_error_code: errorCode,
			p_available_at: "2026-07-27T00:01:00.000Z",
		});
	});

	it("최대 시도에 도달한 retryable 오류는 dead 종단 상태로 보낸다", async () => {
		const { client, rpc } = createQueueClient([
			claimedJob(20, "https://www.youtube.com/watch?v=abcDEF12345", {
				attempt_count: 5,
			}),
		]);

		const result = await runYouTubeEnrichmentWorker(client, {
			apiKey: "fixture-api-key",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
		});

		expect(result).toMatchObject({ retriedCount: 0, failedCount: 1 });
		expect(rpc).toHaveBeenCalledWith("fail_media_enrichment_job", {
			p_thread_id: 20,
			p_lease_token: "lease-20",
			p_error_code: "YOUTUBE_MAX_ATTEMPTS",
		});
		expect(rpc).not.toHaveBeenCalledWith("retry_media_enrichment_job", expect.anything());
	});

	it("matching lease token이 거부되면 완료나 재시도 건수로 계산하지 않는다", async () => {
		const { client, rpc } = createQueueClient(
			[claimedJob(30, "https://www.youtube.com/watch?v=abcDEF12345")],
			{ rejectLifecycle: true }
		);

		const result = await runYouTubeEnrichmentWorker(client, {
			apiKey: "fixture-api-key",
			fetchImpl: successfulFetch([fixture.items[0]]),
		});

		expect(result).toMatchObject({ readyCount: 0, leaseRejectedCount: 1 });
		expect(rpc).toHaveBeenCalledWith(
			"complete_media_enrichment_job",
			expect.objectContaining({ p_thread_id: 30, p_lease_token: "lease-30" })
		);
	});

	it("retry RPC도 claim에서 받은 matching lease token만 전달한다", async () => {
		const { client, rpc } = createQueueClient(
			[claimedJob(31, "https://www.youtube.com/watch?v=abcDEF12345")],
			{ rejectLifecycle: true }
		);

		const result = await runYouTubeEnrichmentWorker(client, {
			apiKey: "fixture-api-key",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
			now: () => new Date("2026-07-27T00:00:00.000Z"),
		});

		expect(result).toMatchObject({ retriedCount: 0, leaseRejectedCount: 1 });
		expect(rpc).toHaveBeenCalledWith(
			"retry_media_enrichment_job",
			expect.objectContaining({ p_thread_id: 31, p_lease_token: "lease-31" })
		);
	});

	it("API key가 비어 있으면 queue를 claim하지 않는다", async () => {
		const { client, rpc } = createQueueClient([]);

		await expect(
			runYouTubeEnrichmentWorker(client, { apiKey: "   ", fetchImpl: vi.fn() })
		).rejects.toMatchObject({ code: "YOUTUBE_API_KEY_MISSING" });
		expect(rpc).not.toHaveBeenCalled();
	});
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import albumFixture from "./fixtures/album.json";
import albumImagesFixture from "./fixtures/album-images.json";
import galleryImageFixture from "./fixtures/gallery-image.json";
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
	options: { rejectLifecycle?: boolean } = {}
) {
	const rpc = vi.fn(async (name: string) => {
		if (name === "claim_media_enrichment_jobs") return { data: jobs, error: null };
		return { data: !options.rejectLifecycle, error: null };
	});
	return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function jsonResponse(value: unknown) {
	return new Response(JSON.stringify(value), { status: 200 });
}

function successfulFetch() {
	return vi.fn(async (input: string | URL | Request) => {
		const pathname = new URL(String(input)).pathname;
		if (pathname === "/3/album/Album12") return jsonResponse(albumFixture);
		if (pathname === "/3/album/Album12/images") return jsonResponse(albumImagesFixture);
		if (pathname === "/3/album/Gal123") return new Response(null, { status: 404 });
		if (pathname === "/3/image/Gal123") return jsonResponse(galleryImageFixture);
		if (pathname === "/3/image/Miss123") return new Response(null, { status: 404 });
		return jsonResponse(imageFixture);
	});
}

describe("runImgurEnrichmentWorker", () => {
	it("한 wave에서 image, album, gallery, direct file을 lease별로 완료한다", async () => {
		const jobs = [
			claimedJob(1, "https://imgur.com/Img1234"),
			claimedJob(2, "https://imgur.com/a/Album12"),
			claimedJob(3, "https://imgur.com/gallery/Gal123"),
			claimedJob(4, "https://i.imgur.com/Img1234.jpg"),
		];
		const { client, rpc } = createQueueClient(jobs);

		const result = await runImgurEnrichmentWorker(client, {
			clientId: "fixture-client-id",
			fetchImpl: successfulFetch(),
		});

		expect(result).toEqual({
			claimedCount: 4,
			readyCount: 4,
			unavailableCount: 0,
			unsupportedCount: 0,
			retriedCount: 0,
			failedCount: 0,
			leaseRejectedCount: 0,
		});
		expect(rpc).toHaveBeenCalledWith("claim_media_enrichment_jobs", {
			p_provider: "imgur",
			p_limit: 4,
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
					preview_urls: expect.arrayContaining([
						"https://i.imgur.com/First12.png",
						"https://i.imgur.com/Video12.mp4",
					]),
				}),
			})
		);
	});

	it("unsupported, 잘못된 ID, unavailable을 외부 원문 없이 종단 처리한다", async () => {
		const jobs = [
			claimedJob(5, "https://imgur.com/user/posts"),
			claimedJob(6, "https://imgur.com/bad-id"),
			claimedJob(7, "https://imgur.com/Miss123"),
		];
		const { client, rpc } = createQueueClient(jobs);

		const result = await runImgurEnrichmentWorker(client, {
			clientId: "fixture-client-id",
			fetchImpl: successfulFetch(),
		});

		expect(result).toMatchObject({
			claimedCount: 3,
			unavailableCount: 1,
			unsupportedCount: 1,
			failedCount: 1,
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
		expect(rpc).toHaveBeenCalledWith("fail_media_enrichment_job", {
			p_thread_id: 6,
			p_lease_token: "imgur-lease-6",
			p_error_code: "IMGUR_INVALID_ID",
		});
	});

	it.each([
		{
			name: "HTTP 429",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
			errorCode: "IMGUR_HTTP_429",
		},
		{
			name: "HTTP 5xx",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
			errorCode: "IMGUR_HTTP_5XX",
		},
		{
			name: "timeout",
			fetchImpl: vi.fn().mockRejectedValue(new DOMException("fixture timeout", "TimeoutError")),
			errorCode: "IMGUR_TIMEOUT",
		},
		{
			name: "network",
			fetchImpl: vi.fn().mockRejectedValue(new TypeError("fixture network")),
			errorCode: "IMGUR_NETWORK",
		},
	])("$name를 durable retry와 available_at으로 보존한다", async ({ fetchImpl, errorCode }) => {
		const { client, rpc } = createQueueClient([claimedJob(10, "https://imgur.com/Img1234")]);

		const result = await runImgurEnrichmentWorker(client, {
			clientId: "fixture-client-id",
			fetchImpl,
			now: () => new Date("2026-07-27T00:00:00.000Z"),
		});

		expect(result.retriedCount).toBe(1);
		expect(rpc).toHaveBeenCalledWith("retry_media_enrichment_job", {
			p_thread_id: 10,
			p_lease_token: "imgur-lease-10",
			p_error_code: errorCode,
			p_available_at: "2026-07-27T00:01:00.000Z",
		});
	});

	it("최대 시도와 lease token 거부를 종단 결과에 반영한다", async () => {
		const maxAttempts = createQueueClient([
			claimedJob(20, "https://imgur.com/Img1234", { attempt_count: 5 }),
		]);
		const maxResult = await runImgurEnrichmentWorker(maxAttempts.client, {
			clientId: "fixture-client-id",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
		});
		expect(maxResult).toMatchObject({ retriedCount: 0, failedCount: 1 });
		expect(maxAttempts.rpc).toHaveBeenCalledWith("fail_media_enrichment_job", {
			p_thread_id: 20,
			p_lease_token: "imgur-lease-20",
			p_error_code: "IMGUR_MAX_ATTEMPTS",
		});

		const rejected = createQueueClient([claimedJob(21, "https://imgur.com/Img1234")], {
			rejectLifecycle: true,
		});
		const rejectedResult = await runImgurEnrichmentWorker(rejected.client, {
			clientId: "fixture-client-id",
			fetchImpl: successfulFetch(),
		});
		expect(rejectedResult).toMatchObject({ readyCount: 0, leaseRejectedCount: 1 });
	});

	it("동시에 실행하는 Imgur 요청 수를 설정된 범위로 제한한다", async () => {
		const jobs = Array.from({ length: 4 }, (_, index) =>
			claimedJob(index + 30, `https://imgur.com/Img12${index}`)
		);
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
			concurrency: 2,
			fetchImpl,
		});

		expect(result.readyCount).toBe(4);
		expect(maximumActiveCount).toBe(2);
	});

	it("claim RPC가 요청 limit보다 많은 job을 반환하면 처리하지 않는다", async () => {
		const jobs = [
			claimedJob(40, "https://imgur.com/Img120"),
			claimedJob(41, "https://imgur.com/Img121"),
		];
		const { client, rpc } = createQueueClient(jobs);
		const fetchImpl = successfulFetch();

		await expect(
			runImgurEnrichmentWorker(client, {
				clientId: "fixture-client-id",
				limit: 1,
				fetchImpl,
			})
		).rejects.toMatchObject({ code: "IMGUR_INVALID_CLAIM_RESPONSE" });
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(rpc).toHaveBeenCalledTimes(1);
	});

	it("Client-ID가 비어 있으면 queue를 claim하지 않는다", async () => {
		const { client, rpc } = createQueueClient([]);

		await expect(
			runImgurEnrichmentWorker(client, { clientId: " ", fetchImpl: vi.fn() })
		).rejects.toMatchObject({ code: "IMGUR_CLIENT_ID_MISSING" });
		expect(rpc).not.toHaveBeenCalled();
	});
});

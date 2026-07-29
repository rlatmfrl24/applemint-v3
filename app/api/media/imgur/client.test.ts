import { describe, expect, it, vi } from "vitest";
import { fetchImgurMetadata, ImgurApiError } from "./client";
import albumFixture from "./fixtures/album.json";
import albumImagesFixture from "./fixtures/album-images.json";
import galleryAlbumFixture from "./fixtures/gallery-album.json";
import galleryImageFixture from "./fixtures/gallery-image.json";
import imageFixture from "./fixtures/image.json";
import { normalizeImgurUrl } from "./url";

function jsonResponse(value: unknown) {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function endpointFetch(responses: Record<string, unknown>) {
	return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
		const url = new URL(String(input));
		const response = responses[url.pathname];
		if (!response) return new Response(null, { status: 404 });
		return jsonResponse(response);
	});
}

describe("fetchImgurMetadata", () => {
	it.each(["https://imgur.com/Img1234", "https://i.imgur.com/Img1234.jpg"])(
		"%s image와 direct file을 공식 image endpoint로 조회한다",
		async (url) => {
			const fetchMock = endpointFetch({ "/3/image/Img1234": imageFixture });

			const { metadata: result, diagnostics } = await fetchImgurMetadata(normalizeImgurUrl(url), {
				clientId: "fixture-client-id",
				fetchImpl: fetchMock,
			});

			expect(result).toEqual({
				title: "Imgur 공식 이미지",
				mediaKind: "image",
				thumbnailUrl: "https://i.imgur.com/Img1234.jpg",
				mediaCount: 1,
				previewUrls: ["https://i.imgur.com/Img1234.jpg"],
			});
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(diagnostics).toMatchObject({
				apiRequestCount: 1,
				httpStatusCounts: { "200": 1 },
			});
			expect(fetchMock.mock.calls[0][1]).toMatchObject({
				method: "GET",
				headers: {
					Accept: "application/json",
					Authorization: "Client-ID fixture-client-id",
				},
			});
		}
	);

	it("album 정보와 album images를 분리 조회해 설명 fallback, cover, 개수, preview 4개만 저장한다", async () => {
		const fetchMock = endpointFetch({
			"/3/album/Album12": albumFixture,
			"/3/album/Album12/images": albumImagesFixture,
		});

		const { metadata: result, diagnostics } = await fetchImgurMetadata(
			normalizeImgurUrl("https://imgur.com/a/Album12"),
			{
				clientId: "fixture-client-id",
				fetchImpl: fetchMock,
			}
		);

		expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
			"/3/album/Album12",
			"/3/album/Album12/images",
		]);
		expect(result).toEqual({
			title: "설명으로 표시하는 앨범",
			mediaKind: "album",
			thumbnailUrl: "https://i.imgur.com/Cover12.jpg",
			mediaCount: 6,
			previewUrls: [
				"https://i.imgur.com/First12.png",
				"https://i.imgur.com/Cover12.jpg",
				"https://i.imgur.com/Gif1234.gif",
				"https://i.imgur.com/Video12.mp4",
			],
		});
		expect(diagnostics).toMatchObject({
			apiRequestCount: 2,
			httpStatusCounts: { "200": 2 },
		});
	});

	it("album 응답에 images가 포함되면 별도 album images 요청 없이 재사용한다", async () => {
		const fetchMock = endpointFetch({
			"/3/album/Album12": {
				...albumFixture,
				data: {
					...albumFixture.data,
					images: albumImagesFixture.data,
				},
			},
		});

		const { metadata: result } = await fetchImgurMetadata(
			normalizeImgurUrl("https://imgur.com/a/Album12"),
			{
				clientId: "fixture-client-id",
				fetchImpl: fetchMock,
			}
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			mediaKind: "album",
			mediaCount: 6,
			previewUrls: [
				"https://i.imgur.com/First12.png",
				"https://i.imgur.com/Cover12.jpg",
				"https://i.imgur.com/Gif1234.gif",
				"https://i.imgur.com/Video12.mp4",
			],
		});
	});

	it("gallery image의 video 종류와 description fallback을 정규화한다", async () => {
		const fetchMock = endpointFetch({ "/3/image/Gal123": galleryImageFixture });

		const { metadata: result, diagnostics } = await fetchImgurMetadata(
			normalizeImgurUrl("https://imgur.com/gallery/Gal123"),
			{
				clientId: "fixture-client-id",
				fetchImpl: fetchMock,
			}
		);

		expect(result).toEqual({
			title: "갤러리 영상 설명",
			mediaKind: "gallery",
			thumbnailUrl: "https://i.imgur.com/Gal123.mp4",
			mediaCount: 1,
			previewUrls: ["https://i.imgur.com/Gal123.mp4"],
		});
		expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
			"/3/album/Gal123",
			"/3/image/Gal123",
		]);
		expect(diagnostics).toMatchObject({
			apiRequestCount: 2,
			httpStatusCounts: { "200": 1, "404": 1 },
		});
	});

	it("빈 gallery album은 포함된 images를 재사용해 0개로 정규화한다", async () => {
		const fetchMock = endpointFetch({
			"/3/album/Gallery12": galleryAlbumFixture,
			"/3/album/Gallery12/images": { data: [] },
		});

		const { metadata: result } = await fetchImgurMetadata(
			normalizeImgurUrl("https://imgur.com/gallery/Gallery12"),
			{ clientId: "fixture-client-id", fetchImpl: fetchMock }
		);

		expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
			"/3/album/Gallery12",
		]);
		expect(result).toEqual({
			title: "갤러리 앨범",
			mediaKind: "gallery",
			thumbnailUrl: null,
			mediaCount: 0,
			previewUrls: [],
		});
	});

	it("빈 album URL은 album images 응답을 확인한 뒤 0개로 정규화한다", async () => {
		const fetchMock = endpointFetch({
			"/3/album/Empty12": {
				data: {
					id: "Empty12",
					title: null,
					description: null,
					cover: null,
					images_count: 0,
				},
			},
			"/3/album/Empty12/images": { data: [] },
		});

		const { metadata: result } = await fetchImgurMetadata(
			normalizeImgurUrl("https://imgur.com/a/Empty12"),
			{
				clientId: "fixture-client-id",
				fetchImpl: fetchMock,
			}
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result).toEqual({
			title: null,
			mediaKind: "album",
			thumbnailUrl: null,
			mediaCount: 0,
			previewUrls: [],
		});
	});

	it.each([
		[404, "IMGUR_HTTP_404", "unavailable"],
		[403, "IMGUR_HTTP_403", "terminal"],
		[429, "IMGUR_HTTP_429", "retryable"],
		[503, "IMGUR_HTTP_5XX", "retryable"],
	] as const)("HTTP %s를 %s로 분류한다", async (status, code, disposition) => {
		const promise = fetchImgurMetadata(normalizeImgurUrl("https://imgur.com/Img1234"), {
			clientId: "fixture-client-id",
			fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status })),
		});

		await expect(promise).rejects.toMatchObject({ code, disposition });
	});

	it.each([
		[{ "X-RateLimit-ClientRemaining": "0" }, "IMGUR_CLIENT_QUOTA_EXHAUSTED", 25 * 60 * 60],
		[{ "X-RateLimit-UserRemaining": "0" }, "IMGUR_USER_RATE_LIMITED", 65 * 60],
		[{ "Retry-After": "120" }, "IMGUR_HTTP_429", 120],
	] as const)(
		"429 header를 %s와 전용 retry 시간으로 분류한다",
		async (headers, code, retryAfterSeconds) => {
			const promise = fetchImgurMetadata(normalizeImgurUrl("https://imgur.com/Img1234"), {
				clientId: "fixture-client-id",
				fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 429, headers })),
			});

			await expect(promise).rejects.toMatchObject({
				code,
				disposition: "retryable",
				retryAfterSeconds,
				httpStatus: 429,
			});
		}
	);

	it("Retry-After HTTP-date와 UserReset + 5분을 현재 시각 기준으로 계산한다", async () => {
		const now = new Date("2026-07-27T00:00:00.000Z");
		const retryAt = new Date(now.getTime() + 10 * 60 * 1_000).toUTCString();
		await expect(
			fetchImgurMetadata(normalizeImgurUrl("https://imgur.com/Img1234"), {
				clientId: "fixture-client-id",
				fetchImpl: vi
					.fn()
					.mockResolvedValue(
						new Response(null, { status: 429, headers: { "Retry-After": retryAt } })
					),
				now: () => now,
			})
		).rejects.toMatchObject({ code: "IMGUR_HTTP_429", retryAfterSeconds: 600 });

		const resetAt = Math.floor((now.getTime() + 20 * 60 * 1_000) / 1_000);
		await expect(
			fetchImgurMetadata(normalizeImgurUrl("https://imgur.com/Img1234"), {
				clientId: "fixture-client-id",
				fetchImpl: vi.fn().mockResolvedValue(
					new Response(null, {
						status: 429,
						headers: {
							"X-RateLimit-UserRemaining": "0",
							"X-RateLimit-UserReset": String(resetAt),
						},
					})
				),
				now: () => now,
			})
		).rejects.toMatchObject({
			code: "IMGUR_USER_RATE_LIMITED",
			retryAfterSeconds: 25 * 60,
			rateLimit: {
				userRemaining: 0,
				userResetAt: "2026-07-27T00:20:00.000Z",
			},
		});
	});

	it("malformed rate-limit header는 무시하고 cooldown을 1분~25시간으로 제한한다", async () => {
		const now = new Date("2026-07-27T00:00:00.000Z");
		for (const [value, expected] of [
			["1", 60],
			["not-a-date", 60 * 60],
			["999999", 25 * 60 * 60],
		] as const) {
			await expect(
				fetchImgurMetadata(normalizeImgurUrl("https://imgur.com/Img1234"), {
					clientId: "fixture-client-id",
					fetchImpl: vi
						.fn()
						.mockResolvedValue(
							new Response(null, { status: 429, headers: { "Retry-After": value } })
						),
					now: () => now,
				})
			).rejects.toMatchObject({ code: "IMGUR_HTTP_429", retryAfterSeconds: expected });
		}
	});

	it("403은 quota remaining이 0일 때만 rate-limit retry로 분류한다", async () => {
		await expect(
			fetchImgurMetadata(normalizeImgurUrl("https://imgur.com/Img1234"), {
				clientId: "fixture-client-id",
				fetchImpl: vi.fn().mockResolvedValue(
					new Response(null, {
						status: 403,
						headers: { "X-RateLimit-ClientRemaining": "0" },
					})
				),
			})
		).rejects.toMatchObject({
			code: "IMGUR_CLIENT_QUOTA_EXHAUSTED",
			disposition: "retryable",
			httpStatus: 403,
		});
	});

	it("성공 응답의 remaining 0을 노출하고 album의 추가 요청을 중단한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(albumFixture), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"X-RateLimit-ClientRemaining": "0",
				},
			})
		);

		const result = await fetchImgurMetadata(normalizeImgurUrl("https://imgur.com/a/Album12"), {
			clientId: "fixture-client-id",
			fetchImpl: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			metadata: { mediaKind: "album", mediaCount: 6, previewUrls: [] },
			diagnostics: {
				apiRequestCount: 1,
				rateLimit: { clientRemaining: 0 },
			},
		});
	});

	it.each([
		[new DOMException("fixture timeout", "TimeoutError"), "IMGUR_TIMEOUT"],
		[new TypeError("fixture network"), "IMGUR_NETWORK"],
	] as const)("%s를 retryable %s로 분류한다", async (error, code) => {
		const promise = fetchImgurMetadata(normalizeImgurUrl("https://imgur.com/Img1234"), {
			clientId: "fixture-client-id",
			fetchImpl: vi.fn().mockRejectedValue(error),
		});

		await expect(promise).rejects.toMatchObject({ code, disposition: "retryable" });
	});

	it("Client-ID와 유효한 target이 없으면 네트워크 전에 종단 거부한다", async () => {
		const fetchMock = vi.fn();
		await expect(
			fetchImgurMetadata(normalizeImgurUrl("https://imgur.com/Img1234"), {
				clientId: " ",
				fetchImpl: fetchMock,
			})
		).rejects.toEqual(new ImgurApiError("IMGUR_CLIENT_ID_MISSING", "terminal"));
		await expect(
			fetchImgurMetadata(normalizeImgurUrl("https://imgur.com/bad-id"), {
				clientId: "fixture-client-id",
				fetchImpl: fetchMock,
			})
		).rejects.toMatchObject({ code: "IMGUR_INVALID_TARGET", disposition: "terminal" });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

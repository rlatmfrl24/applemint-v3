import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/videos-list-success.json";
import {
	listYouTubeVideos,
	YOUTUBE_VIDEOS_LIST_ENDPOINT,
	YOUTUBE_VIDEOS_LIST_PARTS,
	YouTubeApiError,
} from "./videos-list";

describe("listYouTubeVideos", () => {
	it("공식 videos.list endpoint에 중복 제거한 ID와 필요한 part만 요청한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(fixture), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})
		);

		const videos = await listYouTubeVideos(
			["abcDEF12345", "liveABC1234", "abcDEF12345", "soonABC1234"],
			{ apiKey: "fixture-api-key", fetchImpl: fetchMock }
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
		expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(YOUTUBE_VIDEOS_LIST_ENDPOINT);
		expect(requestUrl.searchParams.get("part")).toBe(YOUTUBE_VIDEOS_LIST_PARTS);
		expect(requestUrl.searchParams.get("id")).toBe("abcDEF12345,liveABC1234,soonABC1234");
		expect(videos.get("abcDEF12345")).toEqual({
			id: "abcDEF12345",
			title: "Fixture video",
			channelTitle: "Fixture channel",
			thumbnailUrl: "https://img.youtube.test/maxres.jpg",
			durationSeconds: 125,
			liveStatus: "none",
		});
		expect(videos.get("liveABC1234")).toMatchObject({ liveStatus: "live" });
		expect(videos.get("soonABC1234")).toMatchObject({ liveStatus: "upcoming" });
	});

	it("응답에 없는 ID는 adapter 결과에서 누락된 상태로 유지한다", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ items: [fixture.items[0]] }), { status: 200 })
			);

		const videos = await listYouTubeVideos(["abcDEF12345", "missABC1234"], {
			apiKey: "fixture-api-key",
			fetchImpl: fetchMock,
		});

		expect(videos.has("abcDEF12345")).toBe(true);
		expect(videos.has("missABC1234")).toBe(false);
	});

	it("잘못된 duration을 원시 응답 없이 안전한 오류 코드로 정규화한다", async () => {
		const invalidFixture = {
			items: [
				{
					...fixture.items[0],
					contentDetails: { duration: "not-a-duration" },
				},
			],
		};
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify(invalidFixture), { status: 200 }));

		const videos = await listYouTubeVideos(["abcDEF12345"], {
			apiKey: "fixture-api-key",
			fetchImpl: fetchMock,
		});

		expect(videos.get("abcDEF12345")).toEqual({
			id: "abcDEF12345",
			errorCode: "YOUTUBE_INVALID_DURATION",
		});
	});

	it.each([
		[429, "YOUTUBE_HTTP_429", "retryable"],
		[503, "YOUTUBE_HTTP_5XX", "retryable"],
		[400, "YOUTUBE_HTTP_4XX", "terminal"],
	] as const)("HTTP %s를 %s로 분류한다", async (status, code, disposition) => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));

		const error = await listYouTubeVideos(["abcDEF12345"], {
			apiKey: "fixture-api-key",
			fetchImpl: fetchMock,
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(YouTubeApiError);
		expect(error).toMatchObject({ code, disposition });
	});
});

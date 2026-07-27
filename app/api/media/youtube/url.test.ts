import { describe, expect, it } from "vitest";
import { normalizeYouTubeUrl } from "./url";

describe("normalizeYouTubeUrl", () => {
	it.each([
		[
			"https://www.youtube.com/watch?v=abcDEF12345",
			{ kind: "watch", mediaKind: "video", videoId: "abcDEF12345" },
		],
		[
			"https://music.youtube.com/watch?v=abcDEF12345&list=mix",
			{ kind: "watch", mediaKind: "video", videoId: "abcDEF12345" },
		],
		[
			"https://youtu.be/abcDEF12345?t=3",
			{ kind: "short-link", mediaKind: "video", videoId: "abcDEF12345" },
		],
		[
			"https://m.youtube.com/shorts/abcDEF12345?feature=share",
			{ kind: "short", mediaKind: "short", videoId: "abcDEF12345" },
		],
		[
			"https://youtube.com/live/liveABC1234",
			{ kind: "live", mediaKind: "live", videoId: "liveABC1234" },
		],
		[
			"https://www.youtube.com/embed/abcDEF12345",
			{ kind: "embed", mediaKind: "video", videoId: "abcDEF12345" },
		],
	])("video ID와 URL 종류를 정규화한다: %s", (url, expected) => {
		expect(normalizeYouTubeUrl(url)).toMatchObject({ ...expected, failureReason: null });
	});

	it.each([
		"https://www.youtube.com/channel/UC123",
		"https://www.youtube.com/playlist?list=PL123",
		"https://www.youtube.com/watch",
		"https://youtu.be/",
	])("video ID가 없는 YouTube URL은 unsupported로 분리한다: %s", (url) => {
		const result = normalizeYouTubeUrl(url);
		expect(result.videoId).toBeNull();
		expect(result.failureReason).not.toBe("invalid-video-id");
	});

	it.each([
		"https://www.youtube.com/watch?v=short",
		"https://www.youtube.com/shorts/contains.invalid",
		"https://youtu.be/too-long-video-id",
	])("형식이 잘못된 video ID를 종단 오류로 구분한다: %s", (url) => {
		expect(normalizeYouTubeUrl(url)).toMatchObject({
			videoId: null,
			failureReason: "invalid-video-id",
		});
	});

	it.each([
		"https://youtube.com.evil.example/watch?v=abcDEF12345",
		"https://example.com/?next=https://youtube.com/watch?v=abcDEF12345",
		"https://user:password@youtube.com/watch?v=abcDEF12345",
		"ftp://youtube.com/watch?v=abcDEF12345",
		"not-a-url",
	])("공급자 hostname이 아닌 URL은 video ID를 추출하지 않는다: %s", (url) => {
		expect(normalizeYouTubeUrl(url)).toMatchObject({
			kind: "unsupported",
			videoId: null,
			failureReason: "not-youtube",
		});
	});
});

import { describe, expect, it } from "vitest";
import { detectKnownThreadType } from "./detected-thread-type";

describe("detectKnownThreadType", () => {
	it.each([
		"https://youtube.com/watch?v=video",
		"https://www.youtube.com/watch?v=video",
		"https://m.youtube.com/shorts/video",
		"https://music.youtube.com/watch?v=video",
		"https://youtu.be/video",
		"https://www.youtube.com/live/video?feature=share",
		"https://www.youtube.com/embed/video#player",
		"https://www.youtube.com/channel/channel-id",
		"https://www.youtube.com/playlist?list=playlist-id",
		"HTTP://YOUTUBE.COM:80/WATCH?v=video",
	])("YouTube URL을 분류한다: %s", (url) => {
		expect(detectKnownThreadType(url)).toBe("youtube");
	});

	it.each([
		"https://imgur.com/image-id",
		"https://www.imgur.com/a/album-id",
		"https://imgur.com/gallery/gallery-id",
		"https://i.imgur.com/image-id.jpg",
		"HTTPS://IMGUR.COM:443/a/album-id?utm_source=test#preview",
	])("Imgur URL을 분류한다: %s", (url) => {
		expect(detectKnownThreadType(url)).toBe("imgur");
	});

	it.each([
		"",
		"not a url",
		"/watch?v=video",
		"ftp://youtube.com/watch?v=video",
		"https://youtube.com/",
		"https://youtu.be/",
		"https://imgur.com/",
		"https://youtube.com.evil.example/watch?v=video",
		"https://imgur.com.evil.example/a/album-id",
		"https://notyoutube.com/watch?v=video",
		"https://example.com/?next=https://youtube.com/watch?v=video",
		"https://example.com/#https://imgur.com/a/album-id",
		"https://user:password@youtube.com/watch?v=video",
	])("알려진 타입이 아닌 URL을 거부한다: %s", (url) => {
		expect(detectKnownThreadType(url)).toBeNull();
	});
});

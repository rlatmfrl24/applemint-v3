import { describe, expect, it } from "vitest";
import { getImgurEmbedTarget } from "./imgur-embed";

describe("getImgurEmbedTarget", () => {
	it.each([
		[
			"https://imgur.com/AbC12",
			{ kind: "image", id: "AbC12", embedUrl: "https://imgur.com/AbC12/embed?context=false" },
		],
		[
			"https://www.imgur.com/a/Album12",
			{
				kind: "album",
				id: "Album12",
				embedUrl: "https://imgur.com/a/Album12/embed?context=false",
			},
		],
		[
			"https://imgur.com/gallery/friendly-title-Gal1234",
			{
				kind: "gallery",
				id: "Gal1234",
				embedUrl: "https://imgur.com/Gal1234/embed?context=false",
			},
		],
		[
			"https://i.imgur.com/Img1234.GIF?download=1#preview",
			{
				kind: "image",
				id: "Img1234",
				embedUrl: "https://imgur.com/Img1234/embed?context=false",
			},
		],
	] as const)("%s를 공식 embed 주소로 변환한다", (url, expected) => {
		expect(getImgurEmbedTarget(url)).toEqual(expected);
	});

	it.each([
		"https://imgur.com/",
		"https://imgur.com/a/",
		"https://imgur.com/gallery/bad-id",
		"https://i.imgur.com/bad.exe",
		"https://imgur.com/user/posts/AbC12",
		"https://imgur.com.evil.example/a/Album12",
		"https://example.com/#https://imgur.com/AbC12",
		"https://user:password@imgur.com/AbC12",
		"not-a-url",
	])("지원하지 않거나 위장된 URL을 거부한다: %s", (url) => {
		expect(getImgurEmbedTarget(url)).toBeNull();
	});
});

import { describe, expect, it } from "vitest";
import { normalizeImgurUrl } from "./url";

describe("normalizeImgurUrl", () => {
	it.each([
		[
			"https://imgur.com/AbC12",
			{ kind: "image", mediaKind: "image", externalId: "AbC12", fileExtension: null },
		],
		[
			"https://www.imgur.com/a/Album12",
			{ kind: "album", mediaKind: "album", externalId: "Album12", fileExtension: null },
		],
		[
			"https://imgur.com/gallery/Gal123",
			{ kind: "gallery", mediaKind: "gallery", externalId: "Gal123", fileExtension: null },
		],
		[
			"https://i.imgur.com/Img1234.GIF?download=1#preview",
			{
				kind: "direct-file",
				mediaKind: "image",
				externalId: "Img1234",
				fileExtension: "gif",
			},
		],
		[
			"http://i.imgur.com/Video12.mp4",
			{
				kind: "direct-file",
				mediaKind: "image",
				externalId: "Video12",
				fileExtension: "mp4",
			},
		],
	] as const)("%s의 종류와 ID를 정규화한다", (url, expected) => {
		expect(normalizeImgurUrl(url)).toMatchObject({ ...expected, failureReason: null });
	});

	it.each([
		["https://imgur.com/", "missing-id"],
		["https://imgur.com/a/", "unsupported-url"],
		["https://imgur.com/gallery/bad-id", "invalid-id"],
		["https://i.imgur.com/bad.exe", "invalid-id"],
		["https://imgur.com/user/posts/AbC12", "unsupported-url"],
		["https://i.imgur.com/a/Album12", "unsupported-url"],
	] as const)("%s를 %s로 거부한다", (url, failureReason) => {
		expect(normalizeImgurUrl(url)).toMatchObject({
			externalId: null,
			failureReason,
		});
	});

	it.each([
		"https://imgur.com.evil.example/AbC12",
		"https://example.com/?next=https://imgur.com/AbC12",
		"https://example.com/#https://i.imgur.com/Img1234.jpg",
		"https://user:password@imgur.com/AbC12",
		"not-a-url",
	])("공급자가 아닌 위장 URL %s를 거부한다", (url) => {
		expect(normalizeImgurUrl(url)).toMatchObject({
			kind: "unsupported",
			failureReason: "not-imgur",
		});
	});
});

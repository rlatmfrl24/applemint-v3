import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("PWA manifest", () => {
	it("설치 범위와 Applemint 표시 계약을 고정한다", () => {
		expect(manifest()).toMatchObject({
			id: "/",
			start_url: "/main",
			scope: "/",
			display: "standalone",
			name: "Applemint",
			short_name: "Applemint",
			lang: "ko-KR",
			theme_color: "#0F172A",
			background_color: "#0F172A",
			prefer_related_applications: false,
		});
	});

	it("일반·maskable 아이콘 크기와 PNG 형식을 선언한다", () => {
		expect(manifest().icons).toEqual([
			{
				src: "/icons/icon-192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icons/icon-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icons/icon-maskable-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		]);
	});

	it.each([
		["public/icons/icon-192.png", 192, 192],
		["public/icons/icon-512.png", 512, 512],
		["public/icons/icon-maskable-512.png", 512, 512],
		["public/icons/apple-touch-icon.png", 180, 180],
		["public/icons/notification-badge-96.png", 96, 96],
	])("%s 자산 크기를 %dx%d로 커밋한다", (file, width, height) => {
		const image = readFileSync(file);
		expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		expect(image.readUInt32BE(16)).toBe(width);
		expect(image.readUInt32BE(20)).toBe(height);
	});
});

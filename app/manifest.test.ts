import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

const paethPredictor = (left: number, up: number, upLeft: number) => {
	const estimate = left + up - upLeft;
	const leftDistance = Math.abs(estimate - left);
	const upDistance = Math.abs(estimate - up);
	const upLeftDistance = Math.abs(estimate - upLeft);

	if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
	if (upDistance <= upLeftDistance) return up;
	return upLeft;
};

const getPngFilterPredictor = (filter: number, left: number, up: number, upLeft: number) => {
	switch (filter) {
		case 0:
			return 0;
		case 1:
			return left;
		case 2:
			return up;
		case 3:
			return Math.floor((left + up) / 2);
		case 4:
			return paethPredictor(left, up, upLeft);
		default:
			throw new Error(`지원하지 않는 PNG 필터입니다: ${filter}`);
	}
};

const getPngChannels = (colorType: number) => {
	if (colorType === 2) return 3;
	if (colorType === 6) return 4;
	throw new Error(`지원하지 않는 PNG 색상 형식입니다: ${colorType}`);
};

const collectIdatChunks = (image: Buffer) => {
	const idatChunks: Buffer[] = [];
	let offset = 8;

	while (offset < image.length) {
		const length = image.readUInt32BE(offset);
		const type = image.toString("ascii", offset + 4, offset + 8);
		if (type === "IDAT") {
			idatChunks.push(image.subarray(offset + 8, offset + 8 + length));
		}
		offset += length + 12;
	}

	return idatChunks;
};

const getPngNeighbors = (
	pixels: Buffer,
	targetOffset: number,
	rowOffset: number,
	stride: number,
	channels: number
) => {
	const hasLeftPixel = rowOffset >= channels;

	return {
		left: hasLeftPixel ? pixels[targetOffset - channels] : 0,
		up: pixels[targetOffset - stride] ?? 0,
		upLeft: hasLeftPixel ? (pixels[targetOffset - stride - channels] ?? 0) : 0,
	};
};

const reconstructPngPixels = (
	compressed: Buffer,
	width: number,
	height: number,
	channels: number
) => {
	const stride = width * channels;
	const pixels = Buffer.alloc(stride * height);
	let sourceOffset = 0;

	for (let y = 0; y < height; y += 1) {
		const filter = compressed[sourceOffset];
		sourceOffset += 1;

		for (let x = 0; x < stride; x += 1) {
			const raw = compressed[sourceOffset];
			sourceOffset += 1;
			const targetOffset = y * stride + x;
			const { left, up, upLeft } = getPngNeighbors(pixels, targetOffset, x, stride, channels);
			const predictor = getPngFilterPredictor(filter, left, up, upLeft);

			pixels[targetOffset] = (raw + predictor) & 0xff;
		}
	}

	return pixels;
};

const readRgbPng = (file: string) => {
	const image = readFileSync(file);
	const width = image.readUInt32BE(16);
	const height = image.readUInt32BE(20);
	const bitDepth = image[24];
	const colorType = image[25];
	const interlace = image[28];
	const channels = getPngChannels(colorType);

	if (bitDepth !== 8 || interlace !== 0) {
		throw new Error("지원하지 않는 PNG 형식입니다.");
	}

	const idatChunks = collectIdatChunks(image);
	const compressed = inflateSync(Buffer.concat(idatChunks));
	const pixels = reconstructPngPixels(compressed, width, height, channels);

	return { channels, height, pixels, width };
};

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

	it("maskable 아이콘 전경을 보장 안전 영역 안에 배치한다", () => {
		const { channels, height, pixels, width } = readRgbPng("public/icons/icon-maskable-512.png");
		const centerX = (width - 1) / 2;
		const centerY = (height - 1) / 2;
		const safeRadius = Math.min(width, height) * 0.4;
		const background = [pixels[0], pixels[1], pixels[2]];
		let foregroundMaxRadius = 0;

		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const offset = (y * width + x) * channels;
				const colorDistance =
					Math.abs(pixels[offset] - background[0]) +
					Math.abs(pixels[offset + 1] - background[1]) +
					Math.abs(pixels[offset + 2] - background[2]);

				if (colorDistance > 0) {
					foregroundMaxRadius = Math.max(foregroundMaxRadius, Math.hypot(x - centerX, y - centerY));
				}
			}
		}

		expect(foregroundMaxRadius).toBeLessThanOrEqual(safeRadius);
	});
});

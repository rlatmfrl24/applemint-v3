import { describe, expect, it } from "vitest";
import { parseYouTubeDuration } from "./duration";

describe("parseYouTubeDuration", () => {
	it.each([
		["PT0S", 0],
		["PT45S", 45],
		["PT2M5S", 125],
		["PT1H2M3S", 3_723],
		["P1DT2H3M4S", 93_784],
		["P2D", 172_800],
	])("%s를 정수 초로 변환한다", (value, expected) => {
		expect(parseYouTubeDuration(value)).toBe(expected);
	});

	it.each([
		"",
		"P",
		"PT",
		"P1DT",
		"1H2M",
		"P1Y",
		"P1M",
		"PT-1S",
		"PT1.5S",
		"pt1m",
		`P${Number.MAX_SAFE_INTEGER}D`,
	])("잘못되거나 안전 범위를 벗어난 duration을 거부한다: %s", (value) => {
		expect(parseYouTubeDuration(value)).toBeNull();
	});
});

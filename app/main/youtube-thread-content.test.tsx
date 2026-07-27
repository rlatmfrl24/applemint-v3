import { createElement, type ImgHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getAllowedMediaUrl } from "@/lib/media-preview";
import type { ThreadItemType } from "@/lib/type-defs";

vi.mock("next/image", () => ({
	default: ({
		fill: _fill,
		src,
		alt,
		...props
	}: ImgHTMLAttributes<HTMLImageElement> & {
		fill?: boolean;
		src: string | { src: string };
	}) =>
		createElement("img", {
			...props,
			src: typeof src === "string" ? src : src.src,
			alt,
		}),
}));

import { ThreadCard } from "./thread-card";
import { formatYouTubeDuration } from "./youtube-thread-content";

type MediaMetadata = NonNullable<ThreadItemType["media_metadata"]>;

const baseMetadata: MediaMetadata = {
	provider: "youtube",
	external_id: "abcdefghijk",
	media_kind: "video",
	status: "ready",
	title: "공식 영상 제목",
	channel_title: "공식 채널",
	thumbnail_url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
	duration_seconds: 125,
	live_status: "none",
	media_count: null,
	preview_urls: [],
	last_error_code: null,
	fetched_at: "2026-07-27T00:00:00.000Z",
	updated_at: "2026-07-27T00:00:00.000Z",
};

const baseThread: ThreadItemType = {
	id: "101",
	type: "youtube",
	url: "https://www.youtube.com/watch?v=abcdefghijk",
	title: "수집 당시 제목",
	description: null,
	host: "Insagirl",
	tag: ["Insagirl"],
	state: "inbox",
	created_at: "2026-07-27T00:00:00.000Z",
	captured_at: "2026-07-27T00:00:00.000Z",
	state_changed_at: "2026-07-27T00:00:00.000Z",
	media_metadata: baseMetadata,
};

function renderThread(overrides: Partial<ThreadItemType> = {}) {
	return renderToStaticMarkup(<ThreadCard thread={{ ...baseThread, ...overrides }} />);
}

function renderMetadata(overrides: Partial<MediaMetadata>) {
	return renderThread({ media_metadata: { ...baseMetadata, ...overrides } });
}

describe("YouTube thread card", () => {
	it("ready 영상은 공식 제목, 수집 문맥, 채널, 썸네일, 길이를 표시한다", () => {
		const markup = renderThread();

		expect(markup).toContain('data-testid="youtube-thread-content"');
		expect(markup).toContain('data-media-status="ready"');
		expect(markup).toContain("공식 영상 제목");
		expect(markup).toContain("수집 문맥: 수집 당시 제목");
		expect(markup).toContain("공식 채널");
		expect(markup).toContain("02:05");
		expect(markup).toContain('alt="공식 영상 제목 썸네일"');
		expect(markup).toContain('aria-label="공식 영상 제목 YouTube에서 열기"');
	});

	it("넓은 화면은 썸네일 비중을 높이고 중복 Open 없이 URL을 정렬한다", () => {
		const markup = renderThread();

		expect(markup).toContain("sm:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)]");
		expect(markup).toContain('data-testid="youtube-thread-footer"');
		expect(markup).toContain("mt-0.5 flex min-w-0 items-center gap-1");
		expect(markup).not.toContain(">Open<");
		expect(markup).not.toContain("mt-auto");
	});

	it("Shorts와 긴 영상 길이를 형식에 맞게 표시한다", () => {
		const markup = renderMetadata({ media_kind: "short", duration_seconds: 7_265 });

		expect(markup).toContain("Shorts");
		expect(markup).toContain("2:01:05");
	});

	it.each([
		["live", "LIVE"],
		["upcoming", "예정"],
	] as const)("%s 상태는 숫자 길이보다 상태 배지를 우선한다", (liveStatus, label) => {
		const markup = renderMetadata({ live_status: liveStatus, duration_seconds: 125 });

		expect(markup).toContain(label);
		expect(markup).not.toContain("02:05");
	});

	it("pending은 같은 grid의 접근 가능한 skeleton을 유지하고 중복 Open을 표시하지 않는다", () => {
		const markup = renderMetadata({
			status: "pending",
			title: null,
			channel_title: null,
			thumbnail_url: null,
			duration_seconds: null,
			live_status: null,
		});

		expect(markup).toContain('data-media-status="pending"');
		expect(markup).toContain('role="status"');
		expect(markup).toContain('aria-label="YouTube 영상 정보를 불러오는 중"');
		expect(markup).toContain("sm:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)]");
		expect(markup).toContain("수집 당시 제목");
		expect(markup).toContain('aria-label="수집 당시 제목 YouTube에서 열기"');
		expect(markup).not.toContain(">Open<");
	});

	it.each([
		["failed", "불러오기 실패", "영상 정보를 불러오지 못했습니다."],
		["unavailable", "영상 정보 없음", "현재 확인할 수 있는 영상 정보가 없습니다."],
		[
			"unsupported",
			"지원하지 않는 링크",
			"이 YouTube URL 형식은 영상 메타데이터를 지원하지 않습니다.",
		],
	] as const)("%s 상태를 구분해 안내한다", (status, badge, message) => {
		const markup = renderMetadata({
			status,
			title: null,
			channel_title: null,
			thumbnail_url: null,
			duration_seconds: null,
			live_status: null,
		});

		expect(markup).toContain(`data-media-status="${status}"`);
		expect(markup).toContain(badge);
		expect(markup).toContain(message);
	});

	it("metadata가 없는 legacy row는 수집 제목과 기본 정보 상태를 사용한다", () => {
		const markup = renderThread({ media_metadata: null });

		expect(markup).toContain('data-media-status="legacy"');
		expect(markup).toContain("수집 당시 제목");
		expect(markup).toContain("기본 정보");
		expect(markup).toContain("아직 수집된 영상 정보가 없습니다.");
	});

	it("공식 제목과 수집 제목이 모두 없으면 결정론적인 한국어 제목을 사용한다", () => {
		const markup = renderThread({
			title: null,
			media_metadata: { ...baseMetadata, title: null },
		});

		expect(markup).toContain(">YouTube 영상<");
		expect(markup).toContain('aria-label="YouTube 영상 YouTube에서 열기"');
	});

	it("허용되지 않은 썸네일은 외부 이미지를 렌더링하지 않고 접근 가능한 fallback을 쓴다", () => {
		const markup = renderMetadata({
			thumbnail_url: "https://i.ytimg.com.evil.example/thumbnail.jpg",
		});

		expect(markup).not.toContain("<img");
		expect(markup).toContain('role="img"');
		expect(markup).toContain('aria-label="공식 영상 제목 썸네일 없음"');
		expect(markup).toContain("썸네일 없음");
	});

	it("일반 thread는 기존 renderer와 제목, URL을 유지하고 중복 Open을 표시하지 않는다", () => {
		const markup = renderThread({
			type: "normal",
			url: "https://example.com/post",
			title: null,
			host: "example.com",
			media_metadata: null,
		});

		expect(markup).toContain('data-testid="default-thread-content"');
		expect(markup).not.toContain('data-testid="youtube-thread-content"');
		expect(markup).toContain("Untitled");
		expect(markup).toContain("https://example.com/post");
		expect(markup).toContain("example.com");
		expect(markup).not.toContain(">Open<");
	});
});

describe("YouTube card formatters", () => {
	it.each([
		[0, "00:00"],
		[65, "01:05"],
		[3_661, "1:01:01"],
		[-1, null],
		[1.5, null],
		[Number.NaN, null],
		[null, null],
	] as const)("duration %s를 %s로 변환한다", (seconds, expected) => {
		expect(formatYouTubeDuration(seconds)).toBe(expected);
	});

	it("provider별 최소 https hostname만 허용한다", () => {
		expect(getAllowedMediaUrl("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", "youtube")).toBe(
			"https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"
		);
		expect(getAllowedMediaUrl("https://i.imgur.com/image.jpg", "imgur")).toBe(
			"https://i.imgur.com/image.jpg"
		);
		expect(getAllowedMediaUrl("http://i.ytimg.com/image.jpg", "youtube")).toBeNull();
		expect(getAllowedMediaUrl("https://i.ytimg.com.evil.example/image.jpg", "youtube")).toBeNull();
		expect(getAllowedMediaUrl("https://example.com/image.jpg", "youtube")).toBeNull();
	});
});

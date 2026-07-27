import { createElement, type ImgHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ThreadItemType } from "@/lib/type-defs";

vi.mock("next/image", () => ({
	default: ({
		fill: _fill,
		unoptimized: _unoptimized,
		src,
		alt,
		...props
	}: ImgHTMLAttributes<HTMLImageElement> & {
		fill?: boolean;
		unoptimized?: boolean;
		src: string | { src: string };
	}) =>
		createElement("img", {
			...props,
			src: typeof src === "string" ? src : src.src,
			alt,
		}),
}));

import { getImgurCardModel, ImgurPreviewPanel } from "./imgur-thread-content";
import { ThreadCard } from "./thread-card";

type MediaMetadata = NonNullable<ThreadItemType["media_metadata"]>;

const albumMetadata: MediaMetadata = {
	provider: "imgur",
	external_id: "Album12",
	media_kind: "album",
	status: "ready",
	title: "Imgur 공식 앨범",
	channel_title: null,
	thumbnail_url: "https://i.imgur.com/Cover12.jpg",
	duration_seconds: null,
	live_status: null,
	media_count: 6,
	preview_urls: [
		"https://i.imgur.com/First12.png",
		"https://i.imgur.com/Cover12.jpg",
		"https://i.imgur.com/Gif1234.gif",
		"https://i.imgur.com/Video12.mp4",
	],
	last_error_code: null,
	fetched_at: "2026-07-27T00:00:00.000Z",
	updated_at: "2026-07-27T00:00:00.000Z",
};

const baseThread: ThreadItemType = {
	id: "201",
	type: "imgur",
	url: "https://imgur.com/a/Album12",
	title: "수집 당시 앨범 제목",
	description: null,
	host: "Insagirl",
	tag: ["Insagirl"],
	state: "inbox",
	created_at: "2026-07-27T00:00:00.000Z",
	captured_at: "2026-07-27T00:00:00.000Z",
	state_changed_at: "2026-07-27T00:00:00.000Z",
	media_metadata: albumMetadata,
};

function renderThread(overrides: Partial<ThreadItemType> = {}) {
	return renderToStaticMarkup(<ThreadCard thread={{ ...baseThread, ...overrides }} />);
}

function renderMetadata(overrides: Partial<MediaMetadata>) {
	return renderThread({ media_metadata: { ...albumMetadata, ...overrides } });
}

describe("Imgur thread card", () => {
	it("ready album은 공식 제목, 수집 문맥, 규모와 최대 4개 preview를 표시한다", () => {
		const markup = renderThread();

		expect(markup).toContain('data-testid="imgur-thread-content"');
		expect(markup).toContain('data-media-status="ready"');
		expect(markup).toContain("Imgur 공식 앨범");
		expect(markup).toContain("수집 문맥: 수집 당시 앨범 제목");
		expect(markup).toContain("앨범 · 6개");
		expect(markup).toContain('data-preview-count="4"');
		expect(markup).toContain("GIF");
		expect(markup).toContain("영상");
		expect(markup).toContain(">미리보기<");
	});

	it.each([
		[
			{
				media_kind: "image" as const,
				media_count: 1,
				thumbnail_url: "https://i.imgur.com/Gif1234.gif",
				preview_urls: ["https://i.imgur.com/Gif1234.gif"],
			},
			"GIF",
		],
		[
			{
				media_kind: "video" as const,
				media_count: 1,
				thumbnail_url: "https://i.imgur.com/Video12.mp4",
				preview_urls: ["https://i.imgur.com/Video12.mp4"],
			},
			"영상",
		],
		[
			{
				media_kind: "gallery" as const,
				media_count: 3,
				thumbnail_url: "https://i.imgur.com/First12.png",
				preview_urls: ["https://i.imgur.com/First12.png"],
			},
			"갤러리 · 3개",
		],
	] satisfies [Partial<MediaMetadata>, string][])(
		"GIF, video, gallery 종류를 구분한다",
		(overrides, label) => {
			expect(renderMetadata(overrides)).toContain(label);
		}
	);

	it("metadata title이 없으면 원문 제목을 사용하고, 원문도 없으면 결정론적 album fallback을 쓴다", () => {
		expect(renderMetadata({ title: null })).toContain("수집 당시 앨범 제목");
		expect(
			renderThread({
				title: null,
				media_metadata: { ...albumMetadata, title: null },
			})
		).toContain("Imgur 앨범 · 6개");
	});

	it("요청 제한인 pending 항목은 일반 카드로 표시한다", () => {
		const markup = renderMetadata({
			status: "pending",
			title: null,
			thumbnail_url: null,
			media_count: null,
			preview_urls: [],
			last_error_code: "IMGUR_HTTP_429",
		});

		expect(markup).toContain('data-testid="default-thread-content"');
		expect(markup).toContain("수집 당시 앨범 제목");
		expect(markup).toContain(">Open<");
		expect(markup).not.toContain('data-testid="imgur-thread-content"');
		expect(markup).not.toContain('aria-label="Imgur 정보를 불러오는 중"');
	});

	it("metadata가 없는 기존 Imgur 항목은 일반 카드로 표시한다", () => {
		const markup = renderThread({ media_metadata: null });

		expect(markup).toContain('data-testid="default-thread-content"');
		expect(markup).toContain("수집 당시 앨범 제목");
		expect(markup).toContain(">Open<");
		expect(markup).not.toContain('data-testid="imgur-thread-content"');
		expect(markup).not.toContain('aria-label="Imgur 정보를 불러오는 중"');
	});

	it.each([null, "IMGUR_NETWORK"])(
		"요청 제한이 아닌 pending은 기존 skeleton 상태를 유지한다: %s",
		(lastErrorCode) => {
			const markup = renderMetadata({
				status: "pending",
				title: null,
				thumbnail_url: null,
				media_count: null,
				preview_urls: [],
				last_error_code: lastErrorCode,
			});

			expect(markup).toContain('data-media-status="pending"');
			expect(markup).toContain('role="status"');
			expect(markup).toContain('aria-label="Imgur 정보를 불러오는 중"');
			expect(markup).not.toContain('data-testid="default-thread-content"');
		}
	);

	it.each([
		["failed", "불러오기 실패", "Imgur 정보를 불러오지 못했습니다."],
		["unavailable", "정보 없음", "현재 확인할 수 있는 Imgur 정보가 없습니다."],
		["unsupported", "지원하지 않는 링크", "이 Imgur URL 형식은 미리보기를 지원하지 않습니다."],
	] as const)("%s 상태를 구분해 안내한다", (status, badge, message) => {
		const markup = renderMetadata({
			status,
			title: null,
			thumbnail_url: null,
			media_count: null,
			preview_urls: [],
		});

		expect(markup).toContain(`data-media-status="${status}"`);
		expect(markup).toContain(badge);
		expect(markup).toContain(message);
	});

	it("잘못된 preview hostname은 렌더링하지 않고 접근 가능한 fallback을 쓴다", () => {
		const markup = renderMetadata({
			thumbnail_url: "https://i.imgur.com.evil.example/image.jpg",
			preview_urls: ["https://example.com/image.jpg"],
		});

		expect(markup).not.toContain("<img");
		expect(markup).toContain('aria-label="Imgur 공식 앨범 미리보기 없음"');
	});

	it("일반 카드와 YouTube renderer 선택을 회귀시키지 않는다", () => {
		const normalMarkup = renderThread({
			type: "normal",
			url: "https://example.com/post",
			title: "일반 제목",
			media_metadata: null,
		});
		expect(normalMarkup).toContain('data-testid="default-thread-content"');
		expect(normalMarkup).not.toContain('data-testid="imgur-thread-content"');

		const youtubeMarkup = renderThread({
			type: "youtube",
			url: "https://youtube.com/watch?v=abcdefghijk",
			media_metadata: null,
		});
		expect(youtubeMarkup).toContain('data-testid="youtube-thread-content"');
		expect(youtubeMarkup).not.toContain('data-testid="imgur-thread-content"');
	});
});

describe("Imgur preview Drawer", () => {
	it("preview에 제목, 이미지 대체 텍스트와 원본 열기 접근 이름을 제공한다", () => {
		const model = getImgurCardModel(baseThread);
		const markup = renderToStaticMarkup(
			<ImgurPreviewPanel
				model={model}
				threadUrl={baseThread.url}
				headingId="imgur-preview-heading"
			/>
		);

		expect(markup).toContain('id="imgur-preview-heading"');
		expect(markup).toContain("Imgur 공식 앨범 미리보기");
		expect(markup).toContain('alt="Imgur 공식 앨범 미리보기 1"');
		expect(markup).toContain('aria-label="Imgur 공식 앨범 미리보기 4 · 영상"');
		expect(markup).toContain(">Imgur 원본 열기<");
		expect(markup).toContain('target="_blank"');
	});
});

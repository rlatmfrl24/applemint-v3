import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getImgurEmbedTarget } from "@/lib/imgur-embed";
import type { ThreadItemType } from "@/lib/type-defs";
import { ImgurThreadContent } from "./imgur-embed-preview";
import { ThreadCard } from "./thread-card";

const thread: ThreadItemType = {
	id: "202",
	type: "imgur",
	url: "https://imgur.com/a/Album12",
	title: "수집된 Imgur 링크",
	description: "앨범 설명",
	host: "imgur.com",
	tag: ["Insagirl"],
	state: "inbox",
	created_at: "2026-08-11T00:00:00.000Z",
	captured_at: "2026-08-11T00:00:00.000Z",
	state_changed_at: "2026-08-11T00:00:00.000Z",
	media_metadata: null,
};

describe("Imgur embed preview", () => {
	it("기본 카드에서 YouTube 썸네일 크기의 Imgur embed를 표시한다", () => {
		const markup = renderToStaticMarkup(<ThreadCard thread={thread} />);

		expect(markup).toContain('data-testid="imgur-thread-content"');
		expect(markup).toContain("수집된 Imgur 링크");
		expect(markup).toContain("https://imgur.com/a/Album12");
		expect(markup).toContain('data-preview-state="closed"');
		expect(markup).toContain('data-testid="imgur-thumbnail"');
		expect(markup).toContain("aspect-video");
		expect(markup).toContain("sm:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)]");
		expect(markup).toContain('data-testid="imgur-preview-image"');
		expect(markup).toContain('data-preview-variant="thumbnail"');
		expect(markup).toContain(
			'src="/api/media/imgur/thumbnail?url=https%3A%2F%2Fimgur.com%2Fa%2FAlbum12"'
		);
		expect(markup).toContain("object-cover");
		expect(markup).toContain("전체 보기");
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).toContain('aria-label="수집된 Imgur 링크 Imgur에서 열기"');
		expect(markup).not.toContain(">Imgur에서 열기<");
		expect(markup).not.toContain('data-testid="imgur-full-preview"');
	});

	it("썸네일의 전체 보기를 펼치면 카드 안에 전체 embed를 추가한다", () => {
		const target = getImgurEmbedTarget(thread.url);
		expect(target).not.toBeNull();
		if (!target) return;

		const markup = renderToStaticMarkup(
			<ImgurThreadContent
				thread={thread}
				onOpen={() => undefined}
				previewOpen
				onPreviewOpenChange={() => undefined}
			/>
		);

		expect(markup).toContain('data-preview-state="open"');
		expect(markup).toContain('aria-expanded="true"');
		expect(markup).toContain("미리보기 접기");
		expect(markup).toContain('data-testid="imgur-full-preview"');
		expect(markup).toContain('data-preview-variant="full"');
		expect(markup).toContain("object-contain");
	});
});

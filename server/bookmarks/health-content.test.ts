import { expect, it } from "vitest";
import { extractHealthContent } from "./health-content";

const extract = (body: string, truncated = false) =>
	extractHealthContent({ body, finalUrl: "https://example.com/posts/1", truncated });
it("quoted removal notice is not a deletion screen", () => {
	const result = extract(
		"<title>사례 연구</title><article><h1>삭제 안내에 관한 사례 연구</h1><p>게시물이 삭제되었습니다라는 문구를 인용하고 실제 정책과 사례를 설명하는 글입니다. 이 내용은 삭제된 글이 아니라 사례와 해결 방법을 다루는 본문입니다.</p></article>"
	);
	expect(result.evidence.content.status).toBe("present");
});
it("JS shell remains unknown", () => {
	expect(
		extract('<div id="app"></div><script src="/app.js"></script>').evidence.content.status
	).toBe("unknown");
});
it("signed lazy media preserves its query and coverage", () => {
	const result = extract(
		'<article><p>Photo</p><img src="data:image/gif;base64,a" data-src="https://cdn.example.com/a.jpg?token=keep-this"></article>'
	);
	expect(result.mediaRefs[0].url).toBe("https://cdn.example.com/a.jpg?token=keep-this");
	expect(result.mediaRefs[0].label).not.toContain("token");
	expect(
		extract(
			`<article>${Array.from({ length: 21 }, (_, i) => `<img src="/${i}.jpg">`).join("")}</article>`
		).evidence.coverage
	).toBe("limited");
});
it("zero media without baseline is none_detected", () => {
	expect(
		extract("<article><h1>Text only</h1><p>Actual content.</p></article>").evidence.media.status
	).toBe("none_detected");
});
it("truncation never proves missing media or content", () => {
	const result = extract("<article><p>내용이 삭제되었습니다</p></article>", true);
	expect(result.evidence.coverage).toBe("limited");
	expect(result.evidence.content.status).toBe("unknown");
});
it("recognizes access walls without deleting quoted content", () => {
	expect(
		extract('<title>로그인</title><form><input type="password"></form>').evidence.content.status
	).toBe("restricted");
	expect(
		extract("<title>삭제된 게시물</title><main>요청하신 게시물이 삭제되었습니다.</main>").evidence
			.content.status
	).toBe("deleted_suspected");
});

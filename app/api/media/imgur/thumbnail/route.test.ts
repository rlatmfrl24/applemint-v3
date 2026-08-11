import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function request(url: string | null) {
	const endpoint = new URL("http://localhost/api/media/imgur/thumbnail");
	if (url) endpoint.searchParams.set("url", url);
	return new NextRequest(endpoint);
}

describe("GET /api/media/imgur/thumbnail", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("앨범 embed HTML의 첫 썸네일을 카드용 이미지로 리다이렉트한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response('<img class="thumb-title-embed" data-src="//i.imgur.com/ucGf9Gys.jpg">', {
				status: 200,
				headers: { "Content-Type": "text/html" },
			})
		);
		vi.stubGlobal("fetch", fetchMock);

		const response = await GET(request("https://imgur.com/a/VUmDe9h"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("https://i.imgur.com/ucGf9Gyl.jpg");
		expect(response.headers.get("cache-control")).toContain("s-maxage=604800");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://imgur.com/a/VUmDe9h/embed?context=false",
			expect.objectContaining({ signal: expect.any(AbortSignal) })
		);
	});

	it("단일 이미지 embed의 실제 이미지 주소를 유지한다", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response('<img id="image-element" src="//i.imgur.com/r9JkaWWl.png">')
				)
		);

		const response = await GET(request("https://imgur.com/r9JkaWW"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("https://i.imgur.com/r9JkaWWl.png");
	});

	it("동영상 embed에 poster가 없어도 MP4 주소로 정적 썸네일을 만든다", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response('<video class="post"></video><source src="//i.imgur.com/F0Rpeq3.mp4">')
				)
		);

		const response = await GET(request("https://i.imgur.com/F0Rpeq3.mp4"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("https://i.imgur.com/F0Rpeq3l.jpg");
	});

	it("동영상 앨범은 embed metadata의 첫 프레임을 썸네일로 사용한다", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(`
					<script>
						window.album = {"album_images":{"count":1,"images":[{"hash":"F0Rpeq3","ext":".gif","animated":true,"prefer_video":true}]}};
					</script>
				`)
			)
		);

		const response = await GET(request("https://imgur.com/a/a17NqkP"));

		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe("https://i.imgur.com/F0Rpeq3l.jpg");
	});

	it("Imgur가 아닌 입력은 외부 요청 전에 거부한다", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		expect((await GET(request("https://imgur.com.evil.example/a/VUmDe9h"))).status).toBe(400);
		expect((await GET(request(null))).status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("embed HTML이 허용되지 않은 이미지 호스트만 가리키면 실패한다", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response('<img id="image-element" src="https://evil.example/image.jpg">')
				)
		);

		const response = await GET(request("https://imgur.com/r9JkaWW"));

		expect(response.status).toBe(502);
		expect(response.headers.get("location")).toBeNull();
	});
});

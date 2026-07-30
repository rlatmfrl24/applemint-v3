import { describe, expect, it, vi } from "vitest";
import { createThreadSharePayload, isNativeShareSupported, shareThread } from "./native-share";

describe("native share", () => {
	it("title과 URL만 공유하고 Copy와 독립적인 payload를 만든다", () => {
		expect(
			createThreadSharePayload({
				title: "공유할 아이템",
				url: "https://example.com/item",
			})
		).toEqual({
			title: "공유할 아이템",
			url: "https://example.com/item",
		});
		expect(createThreadSharePayload({ title: null, url: "https://example.com/item" })).toEqual({
			title: "Applemint 링크",
			url: "https://example.com/item",
		});
	});

	it("navigator.share 지원 여부를 명시적으로 판정한다", () => {
		expect(isNativeShareSupported({ share: vi.fn() })).toBe(true);
		expect(isNativeShareSupported({})).toBe(false);
	});

	it("공유 취소 AbortError는 오류가 아닌 dismissed로 처리한다", async () => {
		const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
		await expect(
			shareThread({ share }, { title: "아이템", url: "https://example.com/item" })
		).resolves.toBe("dismissed");
	});

	it("일반 공유 실패는 호출자에게 전달한다", async () => {
		const failure = new Error("share failed");
		const share = vi.fn().mockRejectedValue(failure);
		await expect(
			shareThread({ share }, { title: "아이템", url: "https://example.com/item" })
		).rejects.toBe(failure);
	});
});

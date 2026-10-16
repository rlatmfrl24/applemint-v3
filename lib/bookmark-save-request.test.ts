import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { recommendationRequest, registerRecommendationOnce } from "./bookmark-save-request";

describe("save recommendation identity", () => {
	it("closing and reopening the same draft reuses its id, while an explicit new request replaces it", () => {
		const cache = new QueryClient();
		const source = { id: "21", url: "https://example.com/article" };
		const first = recommendationRequest(cache, source, "  제목  ");
		expect(recommendationRequest(cache, source, "제목")).toBe(first);
		expect(
			recommendationRequest(cache, { ...source, url: "https://example.com/other" }, "제목")
		).not.toBe(first);
		expect(recommendationRequest(cache, source, "제목", true)).not.toBe(first);
	});
	it("overlapping registrations share one result and retrying an uncertain failure keeps the request id", async () => {
		const cache = new QueryClient();
		const source = { id: "21", url: "https://example.com/article" };
		const id = recommendationRequest(cache, source, "제목");
		let calls = 0;
		const register = async (requestId: string) => {
			calls++;
			return { id: requestId };
		};
		const results = await Promise.all([
			registerRecommendationOnce(cache, id, register),
			registerRecommendationOnce(cache, id, register),
		]);
		expect(results).toEqual([{ id }, { id }]);
		expect(calls).toBe(1);
		const other = recommendationRequest(cache, source, "다른 제목");
		await expect(
			registerRecommendationOnce(cache, other, async () => {
				throw new Error("response lost");
			})
		).rejects.toThrow("response lost");
		expect(recommendationRequest(cache, source, "다른 제목")).toBe(other);
		expect(await registerRecommendationOnce(cache, other, register)).toEqual({ id: other });
		cache.clear();
	});
});

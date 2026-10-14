import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAIRequest, countAIInput, reserveNano, validateAIItems } from "./ai";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
it("gates inputs locally without sending a paid request or calling OpenAI for token counting", async () => {
	const fetch = vi.spyOn(globalThis, "fetch");
	const request = buildAIRequest("interests", { collections: [] });
	expect(request.model).toBe("openai/gpt-6-luna");
	expect(request.provider).toMatchObject({
		require_parameters: true,
		max_price: { prompt: 0.125, completion: 0.5 },
	});
	expect(await countAIInput(request)).toBeGreaterThanOrEqual(
		Buffer.byteLength(JSON.stringify(request), "utf8")
	);
	expect(fetch).not.toHaveBeenCalled();
});

describe("AI cost and complete outputs", () => {
	it("reserves the maximum output and input category cost without float rounding", () => {
		expect(reserveNano(1000, 8192)).toBe(4_221_000);
	});
	it("rejects output IDs outside the requested set", () => {
		expect(() =>
			validateAIItems(
				[
					{
						id: "other",
						reason: "r",
						collectionId: null,
						newCollectionName: "New",
						relevance: null,
						reviewCandidate: false,
					},
				],
				["a"],
				[]
			)
		).toThrow();
	});
	it("rejects silently missing or duplicated items", () => {
		const item = {
			id: "a",
			reason: "r",
			collectionId: null,
			newCollectionName: "New",
			relevance: null,
			reviewCandidate: false,
		};
		expect(() => validateAIItems([item], ["a", "b"], [])).toThrow();
		expect(() => validateAIItems([item, item], ["a", "b"], [])).toThrow();
	});
	it("allows genuinely new collections", () => {
		expect(
			validateAIItems(
				[
					{
						id: "a",
						reason: "r",
						collectionId: null,
						newCollectionName: "New topic",
						relevance: null,
						reviewCandidate: false,
					},
				],
				["a"],
				[]
			)
		).toHaveLength(1);
	});
});

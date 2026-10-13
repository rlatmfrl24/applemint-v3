import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAIRequest, countAIInput, priceNano, reserveNano, validateAIItems } from "./ai";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
it("counts the identical input and output schema without generation-only options", async () => {
	vi.stubEnv("OPENAI_API_KEY", "fixture-only");
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(Response.json({ input_tokens: 42 }));
	const request = buildAIRequest("interests", { collections: [] });
	expect(await countAIInput(request)).toBe(42);
	expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
		model: request.model,
		input: request.input,
		instructions: request.instructions,
		reasoning: request.reasoning,
		text: request.text,
	});
});

describe("AI cost and complete outputs", () => {
	it("reserves the maximum output and input category cost without float rounding", () => {
		expect(reserveNano(1000, 8192)).toBe(4_221_000);
		expect(priceNano(1000, 8192)).toBe(4_196_000);
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

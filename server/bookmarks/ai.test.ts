import { describe, expect, it } from "vitest";
import { priceNano, reserveNano, validateAIItems } from "./ai";

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

import { afterEach, expect, it, vi } from "vitest";
import {
	bookmarkRecommendationInputSchema,
	bookmarkSaveInputSchema,
} from "@/contracts/bookmark.schema";
import {
	buildRecommendationRequest,
	callRecommendation,
	recommendationReservation,
} from "./recommendation";

const collections = [
	{ id: "aaaaaaaa-0000-4000-8000-000000000001", parent_id: null, name: "study", version: 2 },
	{
		id: "aaaaaaaa-0000-4000-8000-000000000002",
		parent_id: "aaaaaaaa-0000-4000-8000-000000000001",
		name: "AI",
		version: 3,
	},
];
const source = {
	url: "https://example.com/ai",
	sourceTitle: "AI 글",
	officialTitle: "공식 제목",
	title: "수정 제목",
};
it("normalizes the draft title exactly as final saving does", () => {
	const draft = bookmarkRecommendationInputSchema.parse({
		threadId: "1",
		title: "  수정 제목  ",
		requestId: collections[0].id,
	});
	const saved = bookmarkSaveInputSchema.parse({ url: source.url, title: "  수정 제목  " });
	expect(draft.title).toBe(saved.title);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

it("offers every active collection path and unfiled without requiring an already saved bookmark", () => {
	const request = buildRecommendationRequest(source, collections, []);
	expect(request.questions.collection.criteria).toEqual({
		unfiled: "No existing collection fits this bookmark.",
		[collections[0].id]: "study",
		[collections[1].id]: "study / AI",
	});
	expect(request.state).toMatchObject({ bookmark: source, confirmedInterests: [] });
	expect(recommendationReservation()).toEqual({ tokens: 65536, nano: 2752512 });
});

it("settles known usage even if Jev returns a target outside the offered choices", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({
			model: "typesafe/jev-1.13-20260917",
			usage: { input_tokens: 100, output_tokens: 20, cost: 0.0000042 },
			answers: {
				collection: {
					type: "choice",
					choice: "missing",
					confidence: 1,
					probabilities: { missing: 1 },
				},
				basis: {
					type: "choice",
					choice: "topic",
					confidence: 1,
					probabilities: { topic: 1, url: 0, uncertain: 0 },
				},
			},
		})
	);
	const result = await callRecommendation(
		buildRecommendationRequest(source, collections, []),
		collections
	);
	expect(result.chargedNano).toBe(4200);
	expect(result.outputTokens).toBe(20);
	expect(result.recommendation).toBeNull();
});

it("retains a known charge when Jev token metrics exceed the expected context", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({
			model: "typesafe/jev-1.13-20260917",
			usage: { input_tokens: 65537, output_tokens: 0, cost: 1.2 },
		})
	);
	const result = await callRecommendation(
		buildRecommendationRequest(source, collections, []),
		collections
	);
	expect(result.chargedNano).toBe(1200000000);
	expect(result.recommendation).toBeNull();
});

it("retains a known charge even when the provider model field is malformed", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({ model: null, usage: { input_tokens: 100, output_tokens: 20, cost: 1.2 } })
	);
	const result = await callRecommendation(
		buildRecommendationRequest(source, collections, []),
		collections
	);
	expect(result.chargedNano).toBe(1200000000);
	expect(result.recommendation).toBeNull();
});

it("returns the chosen collection version and model confidence without treating confidence as accuracy", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({
			model: "typesafe/jev-1.13-20260917",
			usage: { input_tokens: 250, output_tokens: 60, cost: 0.0000105 },
			answers: {
				collection: {
					type: "choice",
					choice: collections[1].id,
					confidence: 0.6,
					probabilities: { unfiled: 0.1, [collections[0].id]: 0.1, [collections[1].id]: 0.8 },
				},
				basis: {
					type: "choice",
					choice: "topic",
					confidence: 0.8,
					probabilities: { topic: 0.9, url: 0.1, uncertain: 0 },
				},
			},
		})
	);
	const result = await callRecommendation(
		buildRecommendationRequest(source, collections, []),
		collections
	);
	expect(result.recommendation).toMatchObject({
		collectionId: collections[1].id,
		collectionVersion: 3,
		confidence: 0.6,
		basis: "topic",
	});
	expect(result.chargedNano).toBe(10500);
	expect(vi.mocked(fetch)).toHaveBeenCalledWith(
		"https://openrouter.ai/api/v1/systemone",
		expect.objectContaining({
			headers: expect.objectContaining({ Authorization: "Bearer fixture-only" }),
		})
	);
	expect(result.inputTokens).toBe(250);
});

it("retains the reservation for missing cost rather than guessing from token counts", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	const fetch = vi.spyOn(globalThis, "fetch");
	for (const response of [
		{ model: "typesafe/jev-1.13-20260917", answers: {} },
		{
			model: "typesafe/jev-1.13-20260917",
			usage: { input_tokens: 250, output_tokens: 5 },
			answers: {},
		},
	]) {
		fetch.mockResolvedValueOnce(Response.json(response));
		expect(
			(await callRecommendation(buildRecommendationRequest(source, collections, []), collections))
				.chargedNano
		).toBeNull();
	}
});

it("rejects a choice that contradicts its probability distribution while settling known usage", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({
			model: "typesafe/jev-1.13-20260917",
			usage: { input_tokens: 100, output_tokens: 20, cost: 0.0000042 },
			answers: {
				collection: {
					type: "choice",
					choice: "unfiled",
					confidence: 0.2,
					probabilities: { unfiled: 0.1, [collections[0].id]: 0.8, [collections[1].id]: 0.1 },
				},
				basis: {
					type: "choice",
					choice: "topic",
					confidence: 1,
					probabilities: { topic: 1, url: 0, uncertain: 0 },
				},
			},
		})
	);
	const result = await callRecommendation(
		buildRecommendationRequest(source, collections, []),
		collections
	);
	expect(result.recommendation).toBeNull();
	expect(result.chargedNano).toBe(4200);
	expect(result.outputError).toBe("COLLECTION_CHOICE_RANK");
});

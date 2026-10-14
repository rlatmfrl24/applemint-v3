import { afterEach, expect, it, vi } from "vitest";
import { buildAIRequest, callBookmarkAI } from "./ai";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
it("preserves an OpenRouter charge even when the response envelope and token metrics are invalid", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({ output: null, usage: { input_tokens: "invalid", cost: 1.2 } })
	);
	const receipt = await callBookmarkAI(buildAIRequest("interests", {}));
	expect(receipt.output).toBeNull();
	expect(receipt.outputError).toBe("INVALID_RESPONSE");
	expect(receipt.chargedNano).toBe(1200000000);
	expect(receipt.inputTokens).toBeNull();
});
it("keeps a valid model result with an unknown reservation when OpenRouter omits its cost", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({
			status: "completed",
			output: [
				{
					type: "message",
					content: [
						{ type: "output_text", text: JSON.stringify({ items: [], interests: ["기술"] }) },
					],
				},
			],
			usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 0 } },
		})
	);
	const receipt = await callBookmarkAI(buildAIRequest("interests", {}));
	expect(receipt.output?.interests).toEqual(["기술"]);
	expect(receipt.chargedNano).toBeNull();
});

it("settles known usage for invalid model output and exposes only the failed schema field", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({
			status: "completed",
			output: [
				{
					type: "message",
					content: [
						{
							type: "output_text",
							text: JSON.stringify({
								items: [
									{
										id: "book",
										collectionId: null,
										newCollectionName: "",
										reason: "private-provider-text",
										relevance: null,
										reviewCandidate: false,
									},
								],
								interests: [],
							}),
						},
					],
				},
			],
			usage: {
				input_tokens: 100,
				output_tokens: 20,
				input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
				cost: 0.00003,
			},
		})
	);
	const response = await callBookmarkAI(buildAIRequest("classify", {}));
	expect(response.output).toBeNull();
	expect(response.chargedNano).toBe(30000);
	expect(response.outputError).toBe("items.0.newCollectionName:too_small");
	expect(response.outputError).not.toContain("private-provider-text");
});

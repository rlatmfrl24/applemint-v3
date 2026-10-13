import { afterEach, expect, it, vi } from "vitest";
import { buildAIRequest, callBookmarkAI } from "./ai";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
it("keeps a valid model result without guessing missing cache-write billing", async () => {
	vi.stubEnv("OPENAI_API_KEY", "fixture-only");
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

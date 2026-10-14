import { afterEach, expect, it, vi } from "vitest";
import { openrouter, openrouterCost } from "./openrouter";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
it("uses the same OpenRouter key and host for generative and decision requests", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () => Response.json({ usage: { cost: 0 } }));
	for (const path of ["responses", "systemone"] as const) {
		await openrouter(path, { model: "fixture-model" });
		expect(fetch).toHaveBeenLastCalledWith(
			`https://openrouter.ai/api/v1/${path}`,
			expect.objectContaining({
				headers: { "Content-Type": "application/json", Authorization: "Bearer fixture-only" },
			})
		);
	}
});
it("does not use old provider credentials when the OpenRouter key is missing", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "");
	vi.stubEnv("OPENAI_API_KEY", "old-unused");
	vi.stubEnv("TYPESAFE_API_KEY", "old-unused");
	const fetch = vi.spyOn(globalThis, "fetch");
	await expect(openrouter("responses", {})).rejects.toThrow("OPENROUTER_NOT_CONFIGURED");
	expect(fetch).not.toHaveBeenCalled();
});
it("settles the reported charge conservatively in nano-dollars and never guesses missing costs", () => {
	expect(openrouterCost(0.0000105)).toBe(10500);
	expect(openrouterCost(0.0000000001)).toBe(1);
	expect(openrouterCost(0)).toBe(0);
	for (const value of [undefined, null, "0.001", -1, Number.POSITIVE_INFINITY, Number.NaN, 1e12])
		expect(openrouterCost(value)).toBeNull();
});

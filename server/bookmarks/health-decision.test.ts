import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HealthObservation } from "./health";
import { extractHealthContent } from "./health-content";
import {
	buildHealthDecisionRequest,
	callHealthDecision,
	healthDecisionReservation,
	healthEvidenceKey,
} from "./health-decision";

const parsed = extractHealthContent({
	body: "<title>삭제된 게시물</title><main>게시물이 삭제되었습니다.</main>",
	finalUrl: "https://example.com/post?token=keep-this",
	truncated: false,
});
const observation: HealthObservation = {
	...parsed,
	input: {
		bookmarkId: "b",
		url: "https://example.com/post?token=keep-this",
		version: 1,
		baseline: null,
		decisionSample: false,
	},
	reachability: {
		status: "healthy",
		reason: "HTTP 200",
		httpStatus: 200,
		finalUrl: "https://example.com/post?token=keep-this",
	},
};
const answer = (choice: string, keys: string[], confidence = 1) => ({
	type: "choice",
	choice,
	confidence,
	probabilities: Object.fromEntries(keys.map((key) => [key, key === choice ? 1 : 0])),
});
const raw = () => ({
	model: "typesafe/jev-1.13-20260917",
	usage: { input_tokens: 100, output_tokens: 20, cost: 0.000042 },
	answers: {
		pageState: answer("deleted", ["present", "deleted", "restricted", "unrelated", "unknown"]),
		basis: answer("deletion_notice", [
			"deletion_notice",
			"auth_notice",
			"content_match",
			"content_mismatch",
			"insufficient",
		]),
	},
});
beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "fixture-only"));
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
it("reserves a fixed bound and minimizes the provider input", () => {
	const request = buildHealthDecisionRequest(observation);
	expect(healthDecisionReservation()).toEqual({ tokens: 65536, nano: 2752512 });
	expect(JSON.stringify(request)).not.toContain("keep-this");
	expect(request.questions.pageState.criteria).toHaveProperty("unknown");
	expect(healthEvidenceKey(observation)).toBe(healthEvidenceKey(structuredClone(observation)));
	expect(
		healthEvidenceKey({ ...observation, input: { ...observation.input, bookmarkId: "other" } })
	).not.toBe(healthEvidenceKey(observation));
});
it("rejects oversized requests before reserving or calling the provider", () => {
	expect(() => buildHealthDecisionRequest({...observation,input:{...observation.input,title:"x".repeat(12000)}})).toThrow("HEALTH_INPUT_TOO_LARGE");
});
it("keeps a known charge even when the model or output is invalid", async () => {
	const data = raw();
	data.model = "wrong-model";
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(data));
	const outcome = await callHealthDecision(buildHealthDecisionRequest(observation));
	expect(outcome.chargedNano).toBe(42000);
	expect(outcome.outputError).toBe("UNEXPECTED_MODEL");
});
it.each(["choice", "sum", "rank", "usage", "cost"])(
	"rejects invalid %s without inventing evidence",
	async (kind) => {
		const data = raw();
		if (kind === "choice") data.answers.pageState.choice = "outside";
		if (kind === "sum") data.answers.pageState.probabilities.deleted = 0.8;
		if (kind === "rank") {
			data.answers.pageState.probabilities.deleted = 0.2;
			data.answers.pageState.probabilities.present = 0.8;
		}
		if (kind === "usage") data.usage.input_tokens = 65537;
		if (kind === "cost") data.usage.cost = -1;
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(data));
		const outcome = await callHealthDecision(buildHealthDecisionRequest(observation));
		expect(outcome.outputError).not.toBeNull();
		expect(outcome.choice).toBeNull();
	}
);
it("low confidence and contradictory evidence remain unknown", async () => {
	const data = raw();
	data.answers.pageState.confidence = 0.5;
	const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(data));
	expect((await callHealthDecision(buildHealthDecisionRequest(observation))).choice).toBe(
		"unknown"
	);
	const contradictory = raw();
	contradictory.answers.basis = answer(
		"content_match",
		Object.keys(contradictory.answers.basis.probabilities)
	);
	fetch.mockResolvedValueOnce(Response.json(contradictory));
	expect((await callHealthDecision(buildHealthDecisionRequest(observation))).choice).toBe(
		"unknown"
	);
});

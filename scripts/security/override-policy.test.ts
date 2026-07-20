import { describe, expect, it } from "vitest";
import { validateOverrideRegistry } from "./override-policy.mjs";

const registryEntry = {
	manager: "pnpm.overrides",
	selector: "example@^1",
	version: "1.2.3",
	reason: "상위 패키지가 안전 버전을 아직 허용하지 않습니다.",
	introducedAt: "2026-07-01",
	lastReviewedAt: "2026-07-01",
	nextReviewAt: "2026-09-01",
	removalCriteria: "상위 패키지가 1.2.3 이상을 직접 사용하면 제거합니다.",
};

describe("package override registry", () => {
	it("override와 registry가 모두 비어 있으면 통과한다", () => {
		const result = validateOverrideRegistry(
			{},
			{ schemaVersion: 1, entries: [] },
			new Date("2026-07-21T00:00:00Z")
		);

		expect(result).toMatchObject({ valid: true, overrideCount: 0, errors: [] });
	});

	it("등록되지 않은 package override를 차단한다", () => {
		const result = validateOverrideRegistry(
			{ pnpm: { overrides: { "example@^1": "1.2.3" } } },
			{ schemaVersion: 1, entries: [] },
			new Date("2026-07-21T00:00:00Z")
		);

		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			"pnpm.overrides:example@^1: package override is not registered."
		);
	});

	it("검토 기한이 지났거나 90일을 넘는 registry entry를 차단한다", () => {
		const packageJson = { pnpm: { overrides: { "example@^1": "1.2.3" } } };
		const overdue = validateOverrideRegistry(
			packageJson,
			{ schemaVersion: 1, entries: [registryEntry] },
			new Date("2026-10-01T00:00:00Z")
		);
		const tooLong = validateOverrideRegistry(
			packageJson,
			{
				schemaVersion: 1,
				entries: [{ ...registryEntry, nextReviewAt: "2026-12-31" }],
			},
			new Date("2026-07-21T00:00:00Z")
		);

		expect(overdue.errors).toContain("pnpm.overrides:example@^1: override review is overdue.");
		expect(tooLong.errors).toContain(
			"pnpm.overrides:example@^1: next review must be within 90 days."
		);
	});
});

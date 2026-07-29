import { describe, expect, it } from "vitest";
import {
	createMediaWorkerRequestSchema,
	mediaWorkerDiagnosticsSchema,
	mediaWorkerResultSchema,
} from "./media-worker.schema";

describe("media worker contracts", () => {
	it("빈 객체에는 provider별 최대 batch를 적용한다", () => {
		expect(createMediaWorkerRequestSchema(4).parse({})).toEqual({ limit: 4 });
		expect(createMediaWorkerRequestSchema(50).parse({})).toEqual({ limit: 50 });
	});

	it("범위 밖 limit과 추가 필드를 거부한다", () => {
		const schema = createMediaWorkerRequestSchema(4);
		for (const input of [
			{ limit: 0 },
			{ limit: -1 },
			{ limit: 5 },
			{ limit: 1.5 },
			{ limit: "1" },
			{ limit: 1, extra: true },
		]) {
			expect(schema.safeParse(input).success).toBe(false);
		}
	});

	it("worker 결과의 모든 카운터를 비음수 정수로 검증한다", () => {
		const result = {
			claimedCount: 1,
			readyCount: 1,
			unavailableCount: 0,
			unsupportedCount: 0,
			retriedCount: 0,
			failedCount: 0,
			leaseRejectedCount: 0,
		};
		expect(mediaWorkerResultSchema.safeParse(result).success).toBe(true);
		expect(mediaWorkerResultSchema.safeParse({ ...result, failedCount: -1 }).success).toBe(false);
	});

	it("Imgur diagnostics를 선택적으로 허용하고 bounded map과 timestamp를 검증한다", () => {
		const diagnostics = {
			providerOutcome: "rate-limited",
			apiRequestCount: 1,
			rateLimitedCount: 2,
			errorCounts: { IMGUR_HTTP_429: 2 },
			httpStatusCounts: { "429": 1 },
			nextAvailableAt: "2026-07-27T01:00:00.000Z",
			cooldownUntil: "2026-07-27T01:00:00.000Z",
			rateLimit: {
				clientRemaining: 0,
				userRemaining: null,
				userResetAt: null,
			},
		};
		expect(mediaWorkerDiagnosticsSchema.safeParse(diagnostics).success).toBe(true);
		expect(
			mediaWorkerDiagnosticsSchema.safeParse({
				...diagnostics,
				httpStatusCounts: { secret: 1 },
			}).success
		).toBe(false);
		expect(
			mediaWorkerDiagnosticsSchema.safeParse({
				...diagnostics,
				errorCounts: Object.fromEntries(
					Array.from({ length: 17 }, (_, index) => [`IMGUR_ERROR_${index}`, 1])
				),
			}).success
		).toBe(false);
		expect(
			mediaWorkerDiagnosticsSchema.safeParse({
				...diagnostics,
				errorCounts: { ["X".repeat(128)]: 9_999_999_999 },
			}).success
		).toBe(true);
	});
});

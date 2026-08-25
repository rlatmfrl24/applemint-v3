import { describe, expect, it } from "vitest";
import { crawlPolicySettings, NOW } from "@/test/support/communication";
import { crawlPolicySettingsSchema, crawlPolicyUpdateInputSchema } from "./crawl-policy.schema";

describe("crawl policy Zod contract", () => {
	it("네 소스의 정책 응답을 검증한다", () => {
		expect(crawlPolicySettingsSchema.parse(crawlPolicySettings)).toEqual(crawlPolicySettings);
	});

	it("소스 누락과 잘못된 timestamp를 거부한다", () => {
		expect(
			crawlPolicySettingsSchema.safeParse({ ...crawlPolicySettings, sources: [] }).success
		).toBe(false);
		expect(
			crawlPolicySettingsSchema.safeParse({ ...crawlPolicySettings, serverNow: "yesterday" })
				.success
		).toBe(false);
	});

	it("정책 수정 주기를 30분~7일의 1분 단위로 제한한다", () => {
		const base = {
			source: "arcalive",
			scheduleEnabled: false,
			expectedUpdatedAt: NOW,
		} as const;
		expect(crawlPolicyUpdateInputSchema.safeParse({ ...base, cooldownSeconds: 1800 }).success).toBe(
			true
		);
		expect(crawlPolicyUpdateInputSchema.safeParse({ ...base, cooldownSeconds: 1799 }).success).toBe(
			false
		);
		expect(crawlPolicyUpdateInputSchema.safeParse({ ...base, cooldownSeconds: 1801 }).success).toBe(
			false
		);
		expect(
			crawlPolicyUpdateInputSchema.safeParse({ ...base, cooldownSeconds: 604801 }).success
		).toBe(false);
	});

	it("지원하지 않는 소스와 여분의 입력 필드를 거부한다", () => {
		expect(
			crawlPolicyUpdateInputSchema.safeParse({
				source: "unsupported",
				scheduleEnabled: true,
				cooldownSeconds: 3600,
				expectedUpdatedAt: NOW,
			}).success
		).toBe(false);
		expect(
			crawlPolicyUpdateInputSchema.safeParse({
				source: "arcalive",
				scheduleEnabled: true,
				cooldownSeconds: 3600,
				expectedUpdatedAt: NOW,
				unexpected: true,
			}).success
		).toBe(false);
	});
});

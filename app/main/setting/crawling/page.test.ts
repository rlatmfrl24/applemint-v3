import { describe, expect, it } from "vitest";
import type { CrawlSourcePolicy } from "@/lib/crawl-policy-contract";
import {
	getIntervalMode,
	getNextScheduleText,
	hasPolicyChanges,
	nextPolicyBoundary,
	willPolicyBecomeDue,
} from "./page";

const policy: CrawlSourcePolicy = {
	source: "battlepage",
	scheduleEnabled: true,
	cooldownSeconds: 3600,
	recommendedCooldownSeconds: 3600,
	runBudgetSeconds: 45,
	updatedAt: "2026-07-28T01:00:00.000Z",
	lastFinishedAt: "2026-07-28T00:00:00.000Z",
	nextEligibleAt: "2026-07-28T01:00:00.000Z",
	nextScheduledAt: "2026-07-28T01:05:00.000Z",
	activeRunId: null,
	latest: null,
};

describe("수집 정책 Admin UI 상태 계산", () => {
	it("프리셋과 사용자 지정 간격을 구분한다", () => {
		expect(getIntervalMode(3600)).toBe("preset");
		expect(getIntervalMode(5400)).toBe("custom");
	});

	it("예약 시스템과 소스 상태에 맞는 다음 실행 안내를 반환한다", () => {
		const now = new Date("2026-07-28T01:00:00.000Z").getTime();

		expect(getNextScheduleText(policy, false, true, now)).toContain("전체 예약 시스템");
		expect(getNextScheduleText(policy, true, false, now)).toContain("이 소스의 예약 수집");
		expect(getNextScheduleText({ ...policy, activeRunId: "10" }, true, true, now)).toContain(
			"현재 실행 종료 후"
		);
		expect(getNextScheduleText(policy, true, true, now)).toContain("5분 후");
	});

	it("행별 변경 여부와 저장 후 즉시 실행 가능성을 계산한다", () => {
		const now = new Date("2026-07-28T02:00:00.000Z").getTime();

		expect(hasPolicyChanges(policy, true, 3600)).toBe(false);
		expect(hasPolicyChanges(policy, false, 3600)).toBe(true);
		expect(hasPolicyChanges(policy, true, 7200)).toBe(true);
		expect(willPolicyBecomeDue(policy, true, 1800, now)).toBe(true);
		expect(willPolicyBecomeDue(policy, false, 1800, now)).toBe(false);
	});

	it("dispatcher 주기에 맞춰 다음 정책 확인 경계를 계산한다", () => {
		const now = new Date("2026-07-28T01:02:00.000Z").getTime();
		expect(new Date(nextPolicyBoundary(now, 300)).toISOString()).toBe("2026-07-28T01:05:00.000Z");
	});
});

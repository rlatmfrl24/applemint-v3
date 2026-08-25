import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CrawlPolicySettings } from "@/lib/crawl-policy-contract";
import { crawlPolicySettings } from "@/test/support/communication";
import {
	formatCountdown,
	formatSourceSummary,
	getCorrectedNowMs,
	getCrawlPolicyRefetchInterval,
	getDeadlineHandoffDurationMs,
	getInboxSchedulePresentation,
	InboxEmptyStateView,
	selectNextCrawlSchedule,
} from "./inbox-empty-state";

function createSettings(
	overrides: Partial<CrawlPolicySettings> = {},
	sourceTimes: Array<string | null> = [
		"2026-07-30T03:00:00.000Z",
		"2026-07-30T02:00:00.000Z",
		null,
		"2026-07-30T02:00:00.000Z",
		null,
	]
): CrawlPolicySettings {
	return {
		...crawlPolicySettings,
		serverNow: "2026-07-30T01:00:00.000Z",
		sources: crawlPolicySettings.sources.map((source, index) => ({
			...source,
			nextScheduledAt: sourceTimes[index] ?? null,
		})),
		...overrides,
	};
}

describe("Inbox 다음 수집 선택", () => {
	it("활성 소스 중 가장 가까운 시각과 같은 시각의 소스를 함께 선택한다", () => {
		expect(selectNextCrawlSchedule(createSettings())).toEqual({
			scheduledAt: "2026-07-30T02:00:00.000Z",
			scheduledAtMs: new Date("2026-07-30T02:00:00.000Z").getTime(),
			sources: ["battlepage", "insagirl"],
		});
		expect(formatSourceSummary(["battlepage", "insagirl"])).toBe("Battlepage 외 1개");
	});

	it("전체 또는 개별 예약 중지와 null 시각을 후보에서 제외한다", () => {
		const settings = createSettings({}, [
			"2026-07-30T01:30:00.000Z",
			"2026-07-30T02:00:00.000Z",
			null,
			null,
			null,
		]);
		settings.sources[0] = { ...settings.sources[0], scheduleEnabled: false };

		expect(selectNextCrawlSchedule(settings)?.sources).toEqual(["battlepage"]);
		expect(selectNextCrawlSchedule({ ...settings, schedulerEnabled: false })).toBeNull();
	});
});

describe("Inbox cron handoff 추적", () => {
	it("만료 직후 RPC가 다음 버킷으로 넘어가도 제한 시간 동안 5초 확인을 유지한다", () => {
		const advancedSchedule = createSettings({}, [
			"2026-07-30T01:05:00.000Z",
			"2026-07-30T02:00:00.000Z",
			"2026-07-30T03:00:00.000Z",
		]);
		const nowMs = new Date("2026-07-30T01:00:01.000Z").getTime();

		expect(getCrawlPolicyRefetchInterval(advancedSchedule, true)).toBe(5_000);
		expect(getInboxSchedulePresentation(advancedSchedule, nowMs, true)).toEqual({
			kind: "waiting",
			message: "수집 시작을 확인하고 있습니다.",
		});
		expect(getCrawlPolicyRefetchInterval(advancedSchedule, false)).toBe(60_000);
	});

	it("handoff 제한 시간을 최대 실행 예산과 여유 시간으로 계산한다", () => {
		expect(getDeadlineHandoffDurationMs(createSettings())).toBe(75_000);
	});

	it("실행 시작이 관찰되면 handoff와 무관하게 5초 확인을 유지한다", () => {
		const active = createSettings();
		active.sources[0] = { ...active.sources[0], activeRunId: "42", nextScheduledAt: null };

		expect(getCrawlPolicyRefetchInterval(active, false)).toBe(5_000);
	});
});

describe("Inbox 카운트다운 포맷과 시각 보정", () => {
	it.each([
		[-500, "00:00:00"],
		[1, "00:00:01"],
		[3_661_000, "01:01:01"],
		[86_400_000, "1일 00:00:00"],
		[176_461_000, "2일 01:01:01"],
	])("%dms를 %s로 표시한다", (remainingMs, expected) => {
		expect(formatCountdown(remainingMs)).toBe(expected);
	});

	it("서버 응답 시각과 쿼리 갱신 시각의 차이로 로컬 시계를 보정한다", () => {
		const serverNow = "2026-07-30T01:00:00.000Z";
		const serverNowMs = new Date(serverNow).getTime();

		expect(getCorrectedNowMs(10_000, serverNow, serverNowMs - 5_000)).toBe(15_000);
		expect(getCorrectedNowMs(10_000, "invalid", serverNowMs)).toBe(10_000);
	});
});

describe("Inbox 빈 상태 표현", () => {
	it("실행 중 상태가 다음 예약 타이머보다 우선한다", () => {
		const settings = createSettings();
		settings.sources[0] = { ...settings.sources[0], activeRunId: "42" };

		expect(getInboxSchedulePresentation(settings, Date.now())).toEqual({
			kind: "active",
			sources: ["arcalive"],
		});
	});

	it("예약 중지와 타이머 만료 상태를 구분한다", () => {
		expect(
			getInboxSchedulePresentation(
				createSettings({ schedulerEnabled: false }),
				new Date("2026-07-30T01:00:00.000Z").getTime()
			)
		).toEqual({ kind: "stopped", message: "예약 수집이 중지되어 있습니다." });

		expect(
			getInboxSchedulePresentation(
				createSettings({}, [
					"2026-07-30T01:00:00.000Z",
					"2026-07-30T02:00:00.000Z",
					"2026-07-30T03:00:00.000Z",
				]),
				new Date("2026-07-30T01:00:00.000Z").getTime()
			)
		).toEqual({ kind: "waiting", message: "수집 시작을 확인하고 있습니다." });
	});

	it("로딩·오류·카운트다운·실행 중·중지 UI를 렌더링한다", () => {
		const retry = vi.fn();
		const loading = renderToStaticMarkup(<InboxEmptyStateView loading />);
		const error = renderToStaticMarkup(<InboxEmptyStateView error onRetry={retry} />);
		const countdown = renderToStaticMarkup(
			<InboxEmptyStateView
				presentation={{
					kind: "countdown",
					remainingMs: 3_661_000,
					schedule: {
						scheduledAt: "2026-07-30T02:00:00.000Z",
						scheduledAtMs: new Date("2026-07-30T02:00:00.000Z").getTime(),
						sources: ["arcalive", "battlepage"],
					},
				}}
			/>
		);
		const active = renderToStaticMarkup(
			<InboxEmptyStateView presentation={{ kind: "active", sources: ["insagirl"] }} />
		);
		const stopped = renderToStaticMarkup(
			<InboxEmptyStateView
				presentation={{ kind: "stopped", message: "예약 수집이 중지되어 있습니다." }}
			/>
		);

		expect(loading).toContain("다음 수집 일정을 확인하고 있습니다.");
		expect(error).toContain("다음 수집 일정을 불러오지 못했습니다.");
		expect(error).toContain("다시 시도");
		expect(countdown).toContain("01:01:01");
		expect(countdown).toContain("Arcalive 외 1개");
		expect(active).toContain("Insagirl 수집 중");
		expect(stopped).toContain('href="/main/setting/crawling"');
	});
});

import type { CrawlPolicySettings } from "@/contracts/crawl-policy.schema";

export const NOW = "2026-07-22T12:00:00.000Z";

export const threadRow = {
	id: 3,
	created_at: "2026-07-18T12:00:00.000Z",
	type: "youtube",
	url: "https://www.youtube.com/watch?v=video",
	title: "three",
	description: null,
	host: "youtube.com",
	tag: null,
	state: "inbox" as const,
	captured_at: "2026-07-18T12:00:00.000Z",
	state_changed_at: NOW,
	media_metadata: {
		provider: "youtube" as const,
		external_id: "video",
		media_kind: "video" as const,
		status: "ready" as const,
		title: "공식 제목",
		channel_title: "공식 채널",
		thumbnail_url: "https://i.ytimg.com/vi/video/hqdefault.jpg",
		duration_seconds: 125,
		live_status: "none" as const,
		last_error_code: null,
		fetched_at: "2026-07-20T11:00:00.000Z",
		updated_at: "2026-07-20T11:00:00.000Z",
	},
};

export const crawlPolicySettings: CrawlPolicySettings = {
	schedulerEnabled: true,
	serverNow: NOW,
	dispatcherIntervalSeconds: 300,
	sources: (["arcalive", "battlepage", "insagirl", "issuelink"] as const).map((source) => ({
		source,
		scheduleEnabled: source !== "issuelink",
		cooldownSeconds: source === "issuelink" ? 43200 : 10800,
		recommendedCooldownSeconds: source === "issuelink" ? 43200 : 10800,
		runBudgetSeconds: 45,
		updatedAt: NOW,
		lastFinishedAt: null,
		nextEligibleAt: NOW,
		nextScheduledAt: null,
		activeRunId: null,
		latest: null,
	})),
};

export const crawlRunsBaseDashboard = {
	activeRun: null,
	activeRuns: [],
	runtimeSettings: {
		maxConcurrency: 2,
		lockTtlSeconds: 60,
		heartbeatIntervalSeconds: 15,
	},
	sources: [],
	runs: [],
};

export const crawlAlertsDashboard = {
	alerts: [],
	alertSettings: {
		parserFailureStreak: 2,
		parserDropRatio: 0.5,
		parserDropStreak: 2,
		noSuccessSeconds: 172800,
		transportWindow: 3,
		transportErrorRatio: 0.5,
		transportMinFailures: 2,
		lastEvaluatedAt: null,
	},
};

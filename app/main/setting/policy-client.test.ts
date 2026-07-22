import { describe, expect, it, vi } from "vitest";
import {
	CrawlPolicyUpdateError,
	fetchCrawlPolicySettings,
	updateCrawlPolicy,
} from "./policy-client";

const settings = {
	schedulerEnabled: false,
	serverNow: "2026-07-22T12:00:00.000Z",
	dispatcherIntervalSeconds: 300,
	sources: ["arcalive", "battlepage", "insagirl"].map((source) => ({
		source,
		scheduleEnabled: true,
		cooldownSeconds: 10800,
		recommendedCooldownSeconds: 10800,
		runBudgetSeconds: 45,
		updatedAt: "2026-07-22T12:00:00.000Z",
		lastFinishedAt: null,
		nextEligibleAt: "2026-07-22T12:00:00.000Z",
		nextScheduledAt: null,
		activeRunId: null,
		latest: null,
	})),
};

describe("crawl policy client", () => {
	it("가벼운 정책 endpoint를 no-store로 조회한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json(settings));
		await expect(fetchCrawlPolicySettings(fetchMock)).resolves.toEqual(settings);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/crawl/policies",
			expect.objectContaining({ method: "GET", cache: "no-store" })
		);
	});

	it("정책 수정 payload와 응답을 보존한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json(settings));
		await expect(
			updateCrawlPolicy(
				"battlepage",
				{
					scheduleEnabled: true,
					cooldownSeconds: 14400,
					expectedUpdatedAt: "2026-07-22T12:00:00.000Z",
				},
				fetchMock
			)
		).resolves.toEqual(settings);
		expect(fetchMock.mock.calls[0][0]).toBe("/api/crawl/policies/battlepage");
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			scheduleEnabled: true,
			cooldownSeconds: 14400,
			expectedUpdatedAt: "2026-07-22T12:00:00.000Z",
		});
	});

	it("409 응답의 최신 정책을 충돌 오류에 포함한다", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				Response.json({ error: "다른 화면에서 변경됨", settings }, { status: 409 })
			);
		const error = await updateCrawlPolicy(
			"arcalive",
			{
				scheduleEnabled: false,
				cooldownSeconds: 7200,
				expectedUpdatedAt: "2026-07-22T12:00:00.000Z",
			},
			fetchMock
		).catch((caught) => caught);

		expect(error).toBeInstanceOf(CrawlPolicyUpdateError);
		expect(error).toMatchObject({ httpStatus: 409, latestSettings: settings });
	});
});

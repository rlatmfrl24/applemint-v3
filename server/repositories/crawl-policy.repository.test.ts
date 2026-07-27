import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { crawlPolicySettings, NOW } from "@/test/support/communication";
import { CrawlPolicyRepository } from "./crawl-policy.repository";

describe("CrawlPolicyRepository", () => {
	const rpc = vi.fn();
	const repository = new CrawlPolicyRepository({ rpc } as unknown as SupabaseClient);

	beforeEach(() => rpc.mockReset());

	it("정책 조회 RPC 응답을 Zod로 검증한다", async () => {
		rpc.mockResolvedValue({ data: crawlPolicySettings, error: null });
		await expect(repository.get()).resolves.toEqual(crawlPolicySettings);
		expect(rpc).toHaveBeenCalledWith("get_crawl_source_policy_settings");
	});

	it("손상된 정책 조회 응답을 fail closed 한다", async () => {
		rpc.mockResolvedValue({
			data: { ...crawlPolicySettings, sources: [] },
			error: null,
		});
		await expect(repository.get()).rejects.toMatchObject({ code: "UnexpectedFailure" });
	});

	it("검증된 정책을 compare-and-swap RPC에 전달한다", async () => {
		rpc.mockResolvedValue({
			data: { updated: true, reason: null, settings: crawlPolicySettings },
			error: null,
		});
		await expect(
			repository.update({
				source: "arcalive",
				scheduleEnabled: false,
				cooldownSeconds: 3600,
				expectedUpdatedAt: NOW,
			})
		).resolves.toMatchObject({ updated: true, settings: crawlPolicySettings });
		expect(rpc).toHaveBeenCalledWith("update_crawl_source_policy", {
			p_source: "arcalive",
			p_schedule_enabled: false,
			p_cooldown_seconds: 3600,
			p_expected_updated_at: NOW,
		});
	});

	it("DB 검증 오류와 손상된 수정 결과를 domain error로 변환한다", async () => {
		rpc.mockResolvedValueOnce({
			data: null,
			error: { code: "22023", message: "invalid", details: "", hint: "" },
		});
		await expect(
			repository.update({
				source: "arcalive",
				scheduleEnabled: false,
				cooldownSeconds: 3600,
				expectedUpdatedAt: NOW,
			})
		).rejects.toMatchObject({ code: "InvalidInput" });

		rpc.mockResolvedValueOnce({ data: { updated: true, settings: null }, error: null });
		await expect(
			repository.update({
				source: "arcalive",
				scheduleEnabled: false,
				cooldownSeconds: 3600,
				expectedUpdatedAt: NOW,
			})
		).rejects.toMatchObject({ code: "UnexpectedFailure" });
	});
});

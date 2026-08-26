import { describe, expect, it } from "vitest";
import {
	getInternalSecret,
	getWebPushEnvironment,
	getYouTubeApiKey,
	isCrawlDebugEnabled,
} from "./env/features";
import { getServiceRoleEnvironment } from "./env/service-role";

describe("server environment", () => {
	it("service-role 설정을 검증하고 public URL fallback을 허용한다", () => {
		expect(
			getServiceRoleEnvironment({
				NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
				SUPABASE_SECRET_KEY: "service-secret",
			})
		).toEqual({
			SUPABASE_URL: "https://project.supabase.co",
			SUPABASE_SECRET_KEY: "service-secret",
		});
	});

	it("service-role secret 누락을 명확한 설정 오류로 거부한다", () => {
		expect(() =>
			getServiceRoleEnvironment({ SUPABASE_URL: "https://project.supabase.co" })
		).toThrow("Service-role Supabase environment configuration is invalid.");
	});

	it("선택 기능 키 누락은 해당 기능만 비활성화한다", () => {
		expect(getInternalSecret({})).toBeNull();
		expect(getYouTubeApiKey({})).toBeNull();
		expect(getWebPushEnvironment({ WEB_PUSH_ENABLED: "false" })).toMatchObject({
			WEB_PUSH_ENABLED: "false",
		});
	});

	it("선택 기능 값의 바깥 공백을 제거한다", () => {
		expect(getInternalSecret({ CRAWL_INTERNAL_SECRET: "  internal-secret  " })).toBe(
			"internal-secret"
		);
		expect(getYouTubeApiKey({ YOUTUBE_API_KEY: "  youtube-key  " })).toBe("youtube-key");
	});

	it("crawl debug 설정을 명시적인 값으로만 활성화한다", () => {
		expect(isCrawlDebugEnabled({})).toBe(false);
		expect(isCrawlDebugEnabled({ DEBUG_CRAWL: "true" })).toBe(true);
		expect(isCrawlDebugEnabled({ LOG_LEVEL: "DEBUG" })).toBe(true);
	});
});

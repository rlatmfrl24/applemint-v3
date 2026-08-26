import { describe, expect, it } from "vitest";
import { getClientEnvironment } from "./client";

describe("client environment", () => {
	it("public Supabase URL과 publishable key를 검증한다", () => {
		expect(
			getClientEnvironment({
				NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
				NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
			})
		).toEqual({
			NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
			NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
		});
	});

	it("누락되거나 잘못된 public 설정을 시작 경계에서 거부한다", () => {
		expect(() => getClientEnvironment({})).toThrow(
			"Public Supabase environment configuration is invalid."
		);
		expect(() =>
			getClientEnvironment({
				NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
				NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "key",
			})
		).toThrow("Public Supabase environment configuration is invalid.");
	});
});

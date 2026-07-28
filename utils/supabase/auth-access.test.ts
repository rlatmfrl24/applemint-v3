import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createOwnerClientMock } from "@/test/support/supabase";
import { checkAuthenticatedAccess } from "./auth-access";

describe("checkAuthenticatedAccess", () => {
	it("검증된 claims가 있는 요청만 authenticated로 분류한다", async () => {
		const { client } = createOwnerClientMock({ userId: "owner-id" });
		const metrics = {
			recordAuthCheck: vi.fn(),
		};

		const result = await checkAuthenticatedAccess(client as unknown as SupabaseClient, metrics);

		expect(result).toMatchObject({
			kind: "authenticated",
			claims: { sub: "owner-id" },
		});
		expect(metrics.recordAuthCheck).toHaveBeenCalledWith(expect.any(Number), "succeeded");
	});

	it("세션이 없거나 JWT가 잘못되면 401로 분류한다", async () => {
		const missing = createOwnerClientMock({ userId: null });
		const invalid = createOwnerClientMock({
			userId: null,
			userError: { name: "AuthInvalidJwtError", status: 400 },
		});

		await expect(
			checkAuthenticatedAccess(missing.client as unknown as SupabaseClient)
		).resolves.toMatchObject({ kind: "unauthenticated", status: 401 });
		await expect(
			checkAuthenticatedAccess(invalid.client as unknown as SupabaseClient)
		).resolves.toMatchObject({ kind: "unauthenticated", status: 401 });
	});

	it("Auth 인프라 오류와 예외를 503으로 분류한다", async () => {
		const failed = createOwnerClientMock({
			userId: null,
			userError: { code: "request_timeout", status: 504 },
		});
		const thrownClient = {
			auth: {
				getClaims: vi.fn().mockRejectedValue(new Error("network failed")),
			},
		};

		await expect(
			checkAuthenticatedAccess(failed.client as unknown as SupabaseClient)
		).resolves.toMatchObject({ kind: "unavailable", status: 503 });
		await expect(
			checkAuthenticatedAccess(thrownClient as unknown as SupabaseClient)
		).resolves.toMatchObject({ kind: "unavailable", status: 503 });
	});
});

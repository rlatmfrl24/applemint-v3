import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createOwnerClientMock } from "@/test/support/supabase";
import { checkApplemintOwner } from "./owner-access";

describe("checkApplemintOwner", () => {
	it("로그인하지 않은 요청을 401로 분류한다", async () => {
		const { client } = createOwnerClientMock({ userId: null });
		const result = await checkApplemintOwner(client as unknown as SupabaseClient);

		expect(result).toMatchObject({ kind: "unauthenticated", status: 401 });
	});

	it("세션 누락 Auth 오류를 401로 분류한다", async () => {
		const { client } = createOwnerClientMock({
			userId: null,
			userError: { name: "AuthSessionMissingError", status: 400 },
		});
		const result = await checkApplemintOwner(client as unknown as SupabaseClient);

		expect(result).toMatchObject({ kind: "unauthenticated", status: 401 });
	});

	it("잘못된 JWT를 401로 분류한다", async () => {
		const { client } = createOwnerClientMock({
			userId: null,
			userError: { code: "bad_jwt", status: 400 },
		});
		const result = await checkApplemintOwner(client as unknown as SupabaseClient);

		expect(result).toMatchObject({ kind: "unauthenticated", status: 401 });
	});

	it("Auth 인프라 오류를 503으로 분류한다", async () => {
		const { client } = createOwnerClientMock({
			userId: null,
			userError: { code: "request_timeout", status: 504 },
		});
		const result = await checkApplemintOwner(client as unknown as SupabaseClient);

		expect(result).toMatchObject({ kind: "unavailable", status: 503 });
	});

	it("로그인했지만 소유자가 아닌 요청을 403으로 분류한다", async () => {
		const { client } = createOwnerClientMock({ isOwner: false });
		const result = await checkApplemintOwner(client as unknown as SupabaseClient);

		expect(result).toMatchObject({ kind: "forbidden", status: 403 });
	});

	it("소유자 RPC 오류는 fail-closed 503으로 분류한다", async () => {
		const { client } = createOwnerClientMock({
			ownerError: new Error("database unavailable"),
		});
		const result = await checkApplemintOwner(client as unknown as SupabaseClient);

		expect(result).toMatchObject({ kind: "unavailable", status: 503 });
	});

	it("DB가 확인한 소유자만 통과시킨다", async () => {
		const { client, rpc } = createOwnerClientMock();
		const metrics = {
			recordAuthCheck: vi.fn(),
			recordOwnerCheck: vi.fn(),
		};

		await expect(
			checkApplemintOwner(client as unknown as SupabaseClient, metrics)
		).resolves.toEqual({
			kind: "owner",
		});
		expect(rpc).toHaveBeenCalledWith("is_applemint_owner");
		expect(metrics.recordAuthCheck).toHaveBeenCalledWith(expect.any(Number), "succeeded");
		expect(metrics.recordOwnerCheck).toHaveBeenCalledWith(expect.any(Number), "succeeded");
	});
});

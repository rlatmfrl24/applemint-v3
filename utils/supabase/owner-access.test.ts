import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { checkApplemintOwner } from "./owner-access";

function createSupabaseMock({
	user = { id: "owner" },
	userError = null,
	isOwner = true,
	ownerError = null,
}: {
	user?: { id: string } | null;
	userError?: Error | null;
	isOwner?: boolean | null;
	ownerError?: Error | null;
} = {}) {
	return {
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user }, error: userError }),
		},
		rpc: vi.fn().mockResolvedValue({ data: isOwner, error: ownerError }),
	} as unknown as SupabaseClient;
}

describe("checkApplemintOwner", () => {
	it("로그인하지 않은 요청을 401로 분류한다", async () => {
		const result = await checkApplemintOwner(createSupabaseMock({ user: null }));

		expect(result).toMatchObject({ kind: "unauthenticated", status: 401 });
	});

	it("로그인했지만 소유자가 아닌 요청을 403으로 분류한다", async () => {
		const result = await checkApplemintOwner(createSupabaseMock({ isOwner: false }));

		expect(result).toMatchObject({ kind: "forbidden", status: 403 });
	});

	it("소유자 RPC 오류는 fail-closed 503으로 분류한다", async () => {
		const result = await checkApplemintOwner(
			createSupabaseMock({ ownerError: new Error("database unavailable") })
		);

		expect(result).toMatchObject({ kind: "unavailable", status: 503 });
	});

	it("DB가 확인한 소유자만 통과시킨다", async () => {
		const supabase = createSupabaseMock();

		await expect(checkApplemintOwner(supabase)).resolves.toEqual({ kind: "owner" });
		expect(supabase.rpc).toHaveBeenCalledWith("is_applemint_owner");
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
const checkOwnerMock = vi.hoisted(() => vi.fn());
const checkAuthenticatedMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/utils/supabase/auth-access", () => ({
	checkAuthenticatedAccess: checkAuthenticatedMock,
}));
vi.mock("@/utils/supabase/owner-access", () => ({
	checkApplemintOwner: checkOwnerMock,
}));

import { createTRPCContext } from "./context";

describe("tRPC context", () => {
	beforeEach(() => {
		createClientMock.mockReset();
		checkOwnerMock.mockReset();
		checkAuthenticatedMock.mockReset();
		createClientMock.mockResolvedValue({ rpc: vi.fn() });
		checkOwnerMock.mockResolvedValue({ kind: "owner", claims: { sub: "owner" } });
		checkAuthenticatedMock.mockResolvedValue({
			kind: "authenticated",
			claims: { sub: "owner" },
		});
	});

	it("한 batch context에서 소유자 확인 결과를 재사용한다", async () => {
		const context = await createTRPCContext(new Request("http://localhost/api/trpc"));
		await Promise.all([context.getOwnerAccess(), context.getOwnerAccess()]);
		expect(createClientMock).toHaveBeenCalledOnce();
		expect(checkOwnerMock).toHaveBeenCalledOnce();
		expect(checkOwnerMock).toHaveBeenCalledWith(expect.anything(), context.metrics);
	});

	it("한 batch context에서 claims 검증 결과를 재사용한다", async () => {
		const context = await createTRPCContext(new Request("http://localhost/api/trpc"));
		await Promise.all([context.getAuthenticatedAccess(), context.getAuthenticatedAccess()]);
		expect(createClientMock).toHaveBeenCalledOnce();
		expect(checkAuthenticatedMock).toHaveBeenCalledOnce();
		expect(checkAuthenticatedMock).toHaveBeenCalledWith(expect.anything(), context.metrics);
	});

	it("안전한 x-request-id를 보존한다", async () => {
		const context = await createTRPCContext(
			new Request("http://localhost/api/trpc", {
				headers: { "x-request-id": "browser:request-123" },
			})
		);
		expect(context.requestId).toBe("browser:request-123");
	});

	it("허용하지 않는 request ID는 서버 UUID로 교체한다", async () => {
		const context = await createTRPCContext(
			new Request("http://localhost/api/trpc", {
				headers: { "x-request-id": "unsafe request id with spaces" },
			})
		);
		expect(context.requestId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
		);
	});
});

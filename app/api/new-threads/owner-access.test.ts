import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/server", () => ({
	createClient: createClientMock,
}));

import { GET as getThreads } from "./route";
import { GET as getStats } from "./stats/route";

function mockAccess({
	userId = "owner",
	isOwner = true,
	ownerError = null,
}: {
	userId?: string | null;
	isOwner?: boolean;
	ownerError?: Error | null;
} = {}) {
	createClientMock.mockResolvedValue({
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: userId ? { id: userId } : null },
				error: null,
			}),
		},
		rpc: vi.fn().mockResolvedValue({ data: isOwner, error: ownerError }),
	});
}

function request(path: string) {
	return new Request(`http://localhost${path}`) as NextRequest;
}

describe.each([
	["신규 스레드", (req: NextRequest) => getThreads(req), "/api/new-threads"],
	["신규 스레드 통계", (req: NextRequest) => getStats(req), "/api/new-threads/stats"],
])("%s API 소유자 검사", (_name, handler, path) => {
	beforeEach(() => {
		createClientMock.mockReset();
	});

	it("미로그인 요청에 401을 반환한다", async () => {
		mockAccess({ userId: null });

		const response = await handler(request(path));

		expect(response.status).toBe(401);
	});

	it("비소유자 요청에 403을 반환한다", async () => {
		mockAccess({ isOwner: false });

		const response = await handler(request(path));

		expect(response.status).toBe(403);
	});

	it("소유자 RPC 오류에 503을 반환한다", async () => {
		mockAccess({ ownerError: new Error("rpc unavailable") });

		const response = await handler(request(path));

		expect(response.status).toBe(503);
	});
});

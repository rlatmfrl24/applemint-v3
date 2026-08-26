import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/server/errors/domain-error";

const { configurationMock, createClientMock, ownerAccessMock, sendWebPushTestMock } = vi.hoisted(
	() => ({
		configurationMock: vi.fn(),
		createClientMock: vi.fn(),
		ownerAccessMock: vi.fn(),
		sendWebPushTestMock: vi.fn(),
	})
);

vi.mock("@/server/push/configuration", () => ({
	getWebPushServerConfiguration: configurationMock,
}));
vi.mock("@/server/push/test-sender", () => ({ sendWebPushTest: sendWebPushTestMock }));
vi.mock("@/utils/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/utils/supabase/owner-access", () => ({ checkApplemintOwner: ownerAccessMock }));

import { POST } from "./route";

function request(body: unknown) {
	return new NextRequest("https://applemint.test/api/push/test", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-request-id": "request-123",
		},
		body: JSON.stringify(body),
	});
}

describe("POST /api/push/test", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		createClientMock.mockResolvedValue({ auth: {} });
		ownerAccessMock.mockResolvedValue({ kind: "owner", claims: { sub: "owner" } });
		configurationMock.mockReturnValue({
			enabled: true,
			public: { enabled: true, publicKey: "public", reason: null },
			publicKey: "public",
			privateKey: "private",
			subject: "mailto:owner@applemint.test",
		});
		sendWebPushTestMock.mockResolvedValue({
			sent: true,
			sentAt: "2026-08-26T01:00:00.000Z",
		});
	});

	it("owner 요청을 격리된 sender에 전달하고 외부 tRPC와 같은 결과를 반환한다", async () => {
		const response = await POST(request({ endpoint: "https://push.test/device" }));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			sent: true,
			sentAt: "2026-08-26T01:00:00.000Z",
		});
		expect(sendWebPushTestMock).toHaveBeenCalledWith(
			"https://push.test/device",
			expect.objectContaining({ enabled: true })
		);
	});

	it("owner가 아니면 sender를 호출하지 않는다", async () => {
		ownerAccessMock.mockResolvedValue({
			kind: "unauthenticated",
			status: 401,
			message: "로그인이 필요합니다.",
		});

		const response = await POST(request({ endpoint: "https://push.test/device" }));
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "Unauthenticated" });
		expect(sendWebPushTestMock).not.toHaveBeenCalled();
	});

	it("sender DomainError의 상태와 안전한 data를 보존한다", async () => {
		sendWebPushTestMock.mockRejectedValue(
			new DomainError("CapacityExceeded", "잠시 후 다시 시도해주세요.", {
				retryAfterSeconds: 60,
			})
		);

		const response = await POST(request({ endpoint: "https://push.test/device" }));
		expect(response.status).toBe(429);
		expect(await response.json()).toMatchObject({
			code: "CapacityExceeded",
			data: { retryAfterSeconds: 60, requestId: "request-123" },
		});
	});
});

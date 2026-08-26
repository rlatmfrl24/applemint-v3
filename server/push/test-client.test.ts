import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@/server/errors/domain-error";
import { createWebPushTestClient } from "./test-client";

const context = {
	requestUrl: "https://applemint.test/api/trpc/push.sendTest",
	cookie: "sb-session=owner-session",
	requestId: "request-123",
};

describe("createWebPushTestClient", () => {
	it("owner cookie와 requestId를 내부 route에 전달하고 결과 계약을 검증한다", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(Response.json({ sent: true, sentAt: "2026-08-26T01:00:00.000Z" }));
		const sender = createWebPushTestClient(context, fetchMock);

		await expect(sender("https://push.test/device")).resolves.toEqual({
			sent: true,
			sentAt: "2026-08-26T01:00:00.000Z",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			new URL("https://applemint.test/api/push/test"),
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ endpoint: "https://push.test/device" }),
			})
		);
		const headers = fetchMock.mock.calls[0][1].headers as Headers;
		expect(headers.get("cookie")).toBe("sb-session=owner-session");
		expect(headers.get("x-request-id")).toBe("request-123");
	});

	it("내부 route의 구조화된 오류를 원래 DomainError로 복원한다", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json(
				{
					error: "Web Push 서버 설정이 중단되어 있습니다.",
					code: "ConfigurationUnavailable",
					data: { reasonCode: "disabled", requestId: "request-123" },
				},
				{ status: 503 }
			)
		);

		const error = await createWebPushTestClient(
			context,
			fetchMock
		)("https://push.test/device").catch((value: unknown) => value);
		expect(error).toBeInstanceOf(DomainError);
		expect(error).toMatchObject({
			code: "ConfigurationUnavailable",
			data: { reasonCode: "disabled", requestId: "request-123" },
		});
	});

	it("network와 잘못된 응답을 안전한 경계 오류로 변환한다", async () => {
		const networkSender = createWebPushTestClient(
			context,
			vi.fn().mockRejectedValue(new Error("connection refused"))
		);
		await expect(networkSender("https://push.test/device")).rejects.toMatchObject({
			code: "UpstreamTimeout",
		});

		const invalidSender = createWebPushTestClient(
			context,
			vi.fn().mockResolvedValue(Response.json({ sent: true }))
		);
		await expect(invalidSender("https://push.test/device")).rejects.toMatchObject({
			code: "UnexpectedFailure",
		});
	});
});

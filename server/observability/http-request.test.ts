import { describe, expect, it, vi } from "vitest";
import { observeHttpHandler } from "./http-request";

describe("observeHttpHandler", () => {
	it("응답을 다시 직렬화하지 않고 byte와 안전한 공통 필드만 기록한다", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const handler = observeHttpHandler<Request>(
			{ transport: "internal-rest", operation: "fixture.operation" },
			async (_request, { metrics }) => {
				metrics.recordResult({ claimedCount: 2 });
				return Response.json({ privatePayload: "do-not-log", claimedCount: 2 });
			}
		);

		const response = await handler(
			new Request("http://localhost/internal", {
				headers: { "x-request-id": "fixture-request-1" },
			})
		);
		await response.text();

		expect(response.headers.get("x-request-id")).toBe("fixture-request-1");
		expect(info).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "fixture-request-1",
				operation: "fixture.operation",
				responseBytes: expect.any(Number),
				resultCount: 2,
				outcome: "succeeded",
			})
		);
		expect(JSON.stringify(info.mock.calls)).not.toContain("do-not-log");
	});

	it("4xx 응답을 실패가 아닌 rejection으로 분류한다", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const handler = observeHttpHandler<Request>(
			{ transport: "internal-rest", operation: "fixture.operation" },
			async () => Response.json({ error: "invalid" }, { status: 400 })
		);

		const response = await handler(new Request("http://localhost/internal"));
		await response.text();

		expect(info).toHaveBeenCalledWith(
			expect.objectContaining({
				outcome: "rejected",
				errorCode: "HTTP_400",
			})
		);
	});
});

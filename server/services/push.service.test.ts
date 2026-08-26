import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PushStore } from "@/server/ports/push.store";
import { PushService } from "./push.service";

function configureEnabledWebPush() {
	const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
	const privateKey = Buffer.alloc(32, 2).toString("base64url");
	vi.stubEnv("WEB_PUSH_ENABLED", "true");
	vi.stubEnv("VAPID_PUBLIC_KEY", publicKey);
	vi.stubEnv("VAPID_PRIVATE_KEY", privateKey);
	vi.stubEnv("VAPID_SUBJECT", "mailto:owner@example.com");
}

describe("PushService.sendTest", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("Web Push 설정이 중단되면 service-role sender를 호출하지 않는다", () => {
		vi.stubEnv("WEB_PUSH_ENABLED", "false");
		const sender = vi.fn();
		const service = new PushService({} as PushStore, sender);

		expect(() => service.sendTest("https://push.test/device")).toThrow(
			"Web Push 서버 설정이 중단되어 있습니다."
		);
		expect(sender).not.toHaveBeenCalled();
	});

	it("유효한 VAPID 설정에서만 서버 내부 sender에 위임한다", async () => {
		configureEnabledWebPush();
		const sender = vi.fn().mockResolvedValue({
			sent: true,
			sentAt: "2026-07-30T00:00:00.000Z",
		});
		const service = new PushService({} as PushStore, sender);

		await expect(service.sendTest("https://push.test/device")).resolves.toMatchObject({
			sent: true,
		});
		expect(sender).toHaveBeenCalledWith(
			"https://push.test/device",
			expect.objectContaining({ enabled: true })
		);
	});
});

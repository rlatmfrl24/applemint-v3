import { describe, expect, it, vi } from "vitest";
import { type BeforeInstallPromptEvent, installPromptStore } from "./pwa-install";

describe("PWA install prompt store", () => {
	it("beforeinstallprompt를 자동 표시하지 않고 사용자 클릭까지 보관한다", async () => {
		const event = {
			preventDefault: vi.fn(),
			prompt: vi.fn().mockResolvedValue(undefined),
			userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
		} as unknown as BeforeInstallPromptEvent;

		installPromptStore.capture(event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(installPromptStore.getSnapshot()).toEqual({
			promptAvailable: true,
			installCompleted: false,
		});
		expect(event.prompt).not.toHaveBeenCalled();

		await expect(installPromptStore.prompt()).resolves.toBe("accepted");
		expect(event.prompt).toHaveBeenCalledOnce();
		expect(installPromptStore.getSnapshot()).toEqual({
			promptAvailable: false,
			installCompleted: true,
		});
	});
});

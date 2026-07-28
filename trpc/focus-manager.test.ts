import { afterEach, describe, expect, it, vi } from "vitest";
import { setupBrowserFocusListener } from "./focus-manager";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("browser focus manager", () => {
	it("tab visibility와 window focus를 전달하고 cleanup 시 listener를 제거한다", () => {
		const browserWindow = new EventTarget();
		const handleFocus = vi.fn();
		vi.stubGlobal("window", browserWindow);

		const cleanup = setupBrowserFocusListener(handleFocus);
		browserWindow.dispatchEvent(new Event("visibilitychange"));
		browserWindow.dispatchEvent(new Event("focus"));

		expect(handleFocus).toHaveBeenCalledTimes(2);

		cleanup?.();
		browserWindow.dispatchEvent(new Event("visibilitychange"));
		browserWindow.dispatchEvent(new Event("focus"));

		expect(handleFocus).toHaveBeenCalledTimes(2);
	});
});

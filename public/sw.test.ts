import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function loadServiceWorker() {
	const listeners = new Map<string, (event: unknown) => void>();
	const showNotification = vi.fn().mockResolvedValue(undefined);
	const setAppBadge = vi.fn().mockResolvedValue(undefined);
	const focus = vi.fn().mockResolvedValue(undefined);
	const navigate = vi.fn().mockResolvedValue(undefined);
	const openWindow = vi.fn().mockResolvedValue(undefined);
	const self = {
		location: { origin: "https://applemint.test" },
		navigator: { setAppBadge },
		registration: { showNotification },
		clients: {
			matchAll: vi
				.fn()
				.mockResolvedValue([{ url: "https://applemint.test/saved", navigate, focus }]),
			openWindow,
		},
		addEventListener: (type: string, listener: (event: unknown) => void) => {
			listeners.set(type, listener);
		},
	};
	runInNewContext(readFileSync("public/sw.js", "utf8"), {
		self,
		URL,
		Promise,
		Number,
		Object,
	});
	return { listeners, showNotification, setAppBadge, navigate, focus, openWindow };
}

function pushEvent(payload: unknown) {
	let task: Promise<unknown> | undefined;
	return {
		data: { json: () => payload },
		waitUntil(nextTask: Promise<unknown>) {
			task = nextTask;
		},
		get task() {
			return task;
		},
	};
}

describe("PWA service worker", () => {
	it("fetch handler 없이 Push·클릭만 등록한다", () => {
		const worker = loadServiceWorker();
		expect([...worker.listeners.keys()]).toEqual(["push", "notificationclick"]);
	});

	it("검증된 payload만 알림과 누적 badge에 적용한다", async () => {
		const worker = loadServiceWorker();
		const event = pushEvent({
			v: 1,
			type: "new-items",
			runId: "42",
			source: "battlepage",
			insertedCount: 12,
			badgeCount: 20,
			url: "/main",
		});
		worker.listeners.get("push")?.(event);
		await event.task;

		expect(worker.showNotification).toHaveBeenCalledWith(
			"Applemint 새 아이템",
			expect.objectContaining({
				body: "Battlepage에서 새 아이템 12개를 수집했습니다.",
				badge: "/icons/notification-badge-96.png",
				data: { url: "/main" },
			})
		);
		expect(worker.setAppBadge).toHaveBeenCalledWith(20);
	});

	it("malformed·알 수 없는 버전·추가 개인정보 payload를 안전하게 무시한다", () => {
		const worker = loadServiceWorker();
		for (const payload of [
			{ v: 2, type: "new-items" },
			{
				v: 1,
				type: "new-items",
				runId: "42",
				source: "battlepage",
				insertedCount: 1,
				badgeCount: 1,
				url: "/main",
				title: "노출 금지",
			},
		]) {
			worker.listeners.get("push")?.(pushEvent(payload));
		}
		expect(worker.showNotification).not.toHaveBeenCalled();
		expect(worker.setAppBadge).not.toHaveBeenCalled();
	});

	it("알림 클릭 시 같은 origin 창을 /main으로 이동하고 포커스한다", async () => {
		const worker = loadServiceWorker();
		let task: Promise<unknown> | undefined;
		const event = {
			notification: { close: vi.fn() },
			waitUntil(nextTask: Promise<unknown>) {
				task = nextTask;
			},
		};
		worker.listeners.get("notificationclick")?.(event);
		await task;

		expect(worker.navigate).toHaveBeenCalledWith("https://applemint.test/main");
		expect(worker.focus).toHaveBeenCalledOnce();
		expect(worker.openWindow).not.toHaveBeenCalled();
	});
});

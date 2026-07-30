import { describe, expect, it, vi } from "vitest";
import {
	monitorPwaUpdates,
	PWA_UPDATE_CHECK_INTERVAL_MS,
	type PwaUpdateWorker,
} from "./pwa-update";

function createEventTarget<T extends string>() {
	const listeners = new Map<T, Set<() => void>>();
	return {
		addEventListener(type: T, listener: () => void) {
			const handlers = listeners.get(type) ?? new Set();
			handlers.add(listener);
			listeners.set(type, handlers);
		},
		removeEventListener(type: T, listener: () => void) {
			listeners.get(type)?.delete(listener);
		},
		emit(type: T) {
			for (const listener of listeners.get(type) ?? []) listener();
		},
	};
}

function createWorker(state = "installed") {
	const target = createEventTarget<"statechange">();
	return {
		...target,
		state,
		postMessage: vi.fn(),
	} satisfies PwaUpdateWorker;
}

function createHarness({ controlled = true, waiting = null as PwaUpdateWorker | null } = {}) {
	const registrationEvents = createEventTarget<"updatefound">();
	const containerEvents = createEventTarget<"controllerchange">();
	const documentEvents = createEventTarget<"visibilitychange">();
	const registration = {
		...registrationEvents,
		waiting,
		installing: null as PwaUpdateWorker | null,
		update: vi.fn().mockResolvedValue(undefined),
	};
	const container = {
		...containerEvents,
		controller: controlled ? {} : null,
	};
	const documentTarget = {
		...documentEvents,
		visibilityState: "visible",
	};
	return { registration, container, documentTarget };
}

describe("PWA update monitor", () => {
	it("최초 설치에서는 waiting worker를 안내하지 않는다", () => {
		const worker = createWorker();
		const harness = createHarness({ controlled: false, waiting: worker });
		const onUpdateReady = vi.fn();
		monitorPwaUpdates(harness.registration, harness.container, harness.documentTarget, {
			onUpdateReady,
		});
		expect(onUpdateReady).not.toHaveBeenCalled();
	});

	it("기존 controller가 있으면 waiting 및 updatefound worker를 안내한다", () => {
		const waiting = createWorker();
		const harness = createHarness({ waiting });
		const onUpdateReady = vi.fn();
		monitorPwaUpdates(harness.registration, harness.container, harness.documentTarget, {
			onUpdateReady,
		});
		expect(onUpdateReady).toHaveBeenCalledWith(waiting);

		const installing = createWorker("installing");
		harness.registration.waiting = null;
		harness.registration.installing = installing;
		harness.registration.emit("updatefound");
		installing.state = "installed";
		installing.emit("statechange");
		expect(onUpdateReady).toHaveBeenLastCalledWith(installing);
	});

	it("사용자 확인 후 SKIP_WAITING을 보내고 controllerchange에서 한 번만 reload한다", () => {
		const worker = createWorker();
		const harness = createHarness({ waiting: worker });
		const reload = vi.fn();
		const monitor = monitorPwaUpdates(
			harness.registration,
			harness.container,
			harness.documentTarget,
			{ onUpdateReady: vi.fn(), reload }
		);
		monitor.requestUpdate(worker);
		monitor.requestUpdate(worker);
		expect(worker.postMessage).toHaveBeenCalledOnce();
		expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

		harness.container.emit("controllerchange");
		harness.container.emit("controllerchange");
		expect(reload).toHaveBeenCalledOnce();
	});

	it("foreground update 확인을 30분 간격으로 제한하고 실패를 전파하지 않는다", async () => {
		let currentTime = 1_000;
		const harness = createHarness();
		harness.registration.update.mockRejectedValue(new Error("offline"));
		monitorPwaUpdates(harness.registration, harness.container, harness.documentTarget, {
			onUpdateReady: vi.fn(),
			now: () => currentTime,
		});

		currentTime += PWA_UPDATE_CHECK_INTERVAL_MS - 1;
		harness.documentTarget.emit("visibilitychange");
		expect(harness.registration.update).not.toHaveBeenCalled();

		currentTime += 1;
		harness.documentTarget.emit("visibilitychange");
		expect(harness.registration.update).toHaveBeenCalledOnce();
		await Promise.resolve();
	});
});

export const PWA_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export interface PwaUpdateWorker {
	state: string;
	postMessage(message: unknown): void;
	addEventListener(type: "statechange", listener: () => void): void;
	removeEventListener(type: "statechange", listener: () => void): void;
}

interface UpdateRegistration {
	waiting: PwaUpdateWorker | null;
	installing: PwaUpdateWorker | null;
	update(): Promise<unknown>;
	addEventListener(type: "updatefound", listener: () => void): void;
	removeEventListener(type: "updatefound", listener: () => void): void;
}

interface UpdateContainer {
	controller: unknown;
	addEventListener(type: "controllerchange", listener: () => void): void;
	removeEventListener(type: "controllerchange", listener: () => void): void;
}

interface UpdateDocument {
	visibilityState: string;
	addEventListener(type: "visibilitychange", listener: () => void): void;
	removeEventListener(type: "visibilitychange", listener: () => void): void;
}

interface PwaUpdateMonitorOptions {
	now?: () => number;
	reload?: () => void;
	onUpdateReady(worker: PwaUpdateWorker): void;
}

export interface PwaUpdateMonitor {
	requestUpdate(worker: PwaUpdateWorker): void;
	dispose(): void;
}

export function monitorPwaUpdates(
	registration: UpdateRegistration,
	serviceWorker: UpdateContainer,
	documentTarget: UpdateDocument,
	options: PwaUpdateMonitorOptions
): PwaUpdateMonitor {
	const now = options.now ?? Date.now;
	const reload = options.reload ?? (() => window.location.reload());
	const controlledAtStart = serviceWorker.controller !== null;
	let lastUpdateCheckAt = now();
	let updateRequested = false;
	let reloaded = false;
	let installingWorker: PwaUpdateWorker | null = null;

	const offerUpdate = (worker: PwaUpdateWorker | null) => {
		if (controlledAtStart && worker) {
			options.onUpdateReady(worker);
		}
	};

	const handleInstallingStateChange = () => {
		if (installingWorker?.state === "installed") {
			offerUpdate(registration.waiting ?? installingWorker);
		}
	};

	const handleUpdateFound = () => {
		if (installingWorker) {
			installingWorker.removeEventListener("statechange", handleInstallingStateChange);
		}
		installingWorker = registration.installing;
		installingWorker?.addEventListener("statechange", handleInstallingStateChange);
	};

	const handleControllerChange = () => {
		if (!updateRequested || reloaded) return;
		reloaded = true;
		reload();
	};

	const handleVisibilityChange = () => {
		if (documentTarget.visibilityState !== "visible") return;
		const checkedAt = now();
		if (checkedAt - lastUpdateCheckAt < PWA_UPDATE_CHECK_INTERVAL_MS) return;
		lastUpdateCheckAt = checkedAt;
		registration.update().catch(() => undefined);
	};

	registration.addEventListener("updatefound", handleUpdateFound);
	serviceWorker.addEventListener("controllerchange", handleControllerChange);
	documentTarget.addEventListener("visibilitychange", handleVisibilityChange);
	offerUpdate(registration.waiting);

	return {
		requestUpdate(worker) {
			if (updateRequested) return;
			updateRequested = true;
			worker.postMessage({ type: "SKIP_WAITING" });
		},
		dispose() {
			registration.removeEventListener("updatefound", handleUpdateFound);
			serviceWorker.removeEventListener("controllerchange", handleControllerChange);
			documentTarget.removeEventListener("visibilitychange", handleVisibilityChange);
			installingWorker?.removeEventListener("statechange", handleInstallingStateChange);
		},
	};
}

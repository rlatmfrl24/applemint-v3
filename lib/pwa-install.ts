"use client";

export interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface InstallPromptSnapshot {
	promptAvailable: boolean;
	installCompleted: boolean;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let snapshot: InstallPromptSnapshot = {
	promptAvailable: false,
	installCompleted: false,
};
const listeners = new Set<() => void>();
const serverSnapshot: InstallPromptSnapshot = {
	promptAvailable: false,
	installCompleted: false,
};

function publish(next: InstallPromptSnapshot) {
	snapshot = next;
	for (const listener of listeners) listener();
}

export const installPromptStore = {
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	getSnapshot() {
		return snapshot;
	},
	getServerSnapshot() {
		return serverSnapshot;
	},
	capture(event: BeforeInstallPromptEvent) {
		event.preventDefault();
		deferredPrompt = event;
		publish({ promptAvailable: true, installCompleted: false });
	},
	markInstalled() {
		deferredPrompt = null;
		publish({ promptAvailable: false, installCompleted: true });
	},
	async prompt() {
		const event = deferredPrompt;
		if (!event) return "unavailable" as const;

		await event.prompt();
		const choice = await event.userChoice;
		deferredPrompt = null;
		publish({
			promptAvailable: false,
			installCompleted: choice.outcome === "accepted",
		});
		return choice.outcome;
	},
};

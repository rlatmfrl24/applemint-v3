import type { PushSubscriptionInput } from "@/contracts/push.schema";

interface NavigatorWithStandalone extends Navigator {
	standalone?: boolean;
}

export function isStandaloneDisplay() {
	if (typeof window === "undefined") return false;
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		(window.navigator as NavigatorWithStandalone).standalone === true
	);
}

export function isIosDevice() {
	if (typeof window === "undefined") return false;
	const navigator = window.navigator;
	return (
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
	);
}

export function isWebPushSupported() {
	return (
		typeof window !== "undefined" &&
		"Notification" in window &&
		"serviceWorker" in navigator &&
		"PushManager" in window
	);
}

function urlBase64ToUint8Array(value: string) {
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = window.atob(base64);
	return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function subscriptionToInput(subscription: PushSubscription): PushSubscriptionInput {
	const json = subscription.toJSON();
	if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
		throw new Error("브라우저 알림 구독 정보가 올바르지 않습니다.");
	}
	return {
		endpoint: json.endpoint,
		expirationTime: json.expirationTime ?? null,
		keys: {
			p256dh: json.keys.p256dh,
			auth: json.keys.auth,
		},
	};
}

export async function getCurrentPushSubscription() {
	if (!isWebPushSupported()) return null;
	const registration = await navigator.serviceWorker.ready;
	return registration.pushManager.getSubscription();
}

async function createPushSubscription(publicKey: string) {
	const registration = await navigator.serviceWorker.ready;
	return registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(publicKey),
	});
}

interface PushActivationBrowser {
	getPermission(): NotificationPermission;
	requestPermission(): Promise<NotificationPermission>;
	getSubscription(): Promise<PushSubscription | null>;
	createSubscription(publicKey: string): Promise<PushSubscription>;
}

const defaultPushActivationBrowser: PushActivationBrowser = {
	getPermission: () => Notification.permission,
	requestPermission: () => Notification.requestPermission(),
	getSubscription: getCurrentPushSubscription,
	createSubscription: createPushSubscription,
};

export async function activatePushNotifications(
	publicKey: string,
	saveSubscription: (input: PushSubscriptionInput) => Promise<unknown>,
	browser: PushActivationBrowser = defaultPushActivationBrowser
) {
	let permission = browser.getPermission();
	if (permission === "default") {
		permission = await browser.requestPermission();
	}
	if (permission !== "granted") {
		return { permission, subscription: null };
	}

	const existingSubscription = await browser.getSubscription();
	const subscription = existingSubscription ?? (await browser.createSubscription(publicKey));

	try {
		await saveSubscription(subscriptionToInput(subscription));
		return { permission, subscription };
	} catch (error) {
		if (!existingSubscription) {
			await subscription.unsubscribe().catch(() => false);
		}
		throw error;
	}
}

async function clearAppBadge() {
	if (typeof navigator.clearAppBadge !== "function") return;
	await navigator.clearAppBadge();
}

export async function deactivatePushNotifications(
	subscription: PushSubscription,
	disableServerSubscription: (endpoint: string) => Promise<unknown>,
	clearBadge: () => Promise<void> = clearAppBadge
) {
	await disableServerSubscription(subscription.endpoint);
	await subscription.unsubscribe();
	await clearBadge();
}

export async function acknowledgeCurrentInboxBadge(
	acknowledge: (endpoint: string) => Promise<{ acknowledged: boolean }>,
	browser: {
		getSubscription(): Promise<PushSubscription | null>;
		clearBadge(): Promise<void>;
	} = {
		getSubscription: getCurrentPushSubscription,
		clearBadge: clearAppBadge,
	}
) {
	const subscription = await browser.getSubscription();
	if (!subscription) return false;

	const result = await acknowledge(subscription.endpoint);
	if (!result.acknowledged) return false;
	await browser.clearBadge();
	return true;
}

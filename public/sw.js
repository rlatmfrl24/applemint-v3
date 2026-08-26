const NEW_ITEMS_PAYLOAD_KEYS = [
	"badgeCount",
	"insertedCount",
	"runId",
	"source",
	"type",
	"url",
	"v",
];
const TEST_PAYLOAD_KEYS = ["type", "url", "v"];
const SOURCE_LABELS = {
	arcalive: "Arcalive",
	battlepage: "Battlepage",
	insagirl: "Insagirl",
	issuelink: "IssueLink",
};

function isPositiveInteger(value) {
	return Number.isSafeInteger(value) && value > 0;
}

function hasExactKeys(value, expectedKeys) {
	const keys = Object.keys(value).sort();
	return (
		keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
	);
}

function isValidNewItemsPayload(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	if (!hasExactKeys(value, NEW_ITEMS_PAYLOAD_KEYS)) {
		return false;
	}

	return (
		value.v === 1 &&
		value.type === "new-items" &&
		typeof value.runId === "string" &&
		/^[1-9]\d*$/.test(value.runId) &&
		Object.hasOwn(SOURCE_LABELS, value.source) &&
		isPositiveInteger(value.insertedCount) &&
		isPositiveInteger(value.badgeCount) &&
		value.url === "/main"
	);
}

function isValidTestPayload(value) {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		hasExactKeys(value, TEST_PAYLOAD_KEYS) &&
		value.v === 1 &&
		value.type === "test" &&
		value.url === "/main/setting/app"
	);
}

async function setBadge(count) {
	if (typeof self.navigator?.setAppBadge !== "function") {
		return;
	}

	try {
		await self.navigator.setAppBadge(count);
	} catch {
		// 플랫폼 badge 실패는 사용자에게 표시되는 알림을 취소하지 않는다.
	}
}

self.addEventListener("push", (event) => {
	let payload;
	try {
		payload = event.data?.json();
	} catch {
		return;
	}

	if (isValidTestPayload(payload)) {
		event.waitUntil(
			self.registration.showNotification("Applemint 테스트 알림", {
				body: "이 기기의 Web Push 연결이 정상입니다.",
				icon: "/icons/icon-192.png",
				badge: "/icons/notification-badge-96.png",
				tag: "applemint-test",
				data: { url: "/main/setting/app" },
			})
		);
		return;
	}

	if (!isValidNewItemsPayload(payload)) {
		return;
	}

	const sourceLabel = SOURCE_LABELS[payload.source];
	event.waitUntil(
		Promise.all([
			self.registration.showNotification("Applemint 새 아이템", {
				body: `${sourceLabel}에서 새 아이템 ${payload.insertedCount}개를 수집했습니다.`,
				icon: "/icons/icon-192.png",
				badge: "/icons/notification-badge-96.png",
				tag: `applemint-new-items-${payload.runId}`,
				data: { url: "/main" },
			}),
			setBadge(payload.badgeCount),
		])
	);
});

self.addEventListener("message", (event) => {
	if (
		event.data !== null &&
		typeof event.data === "object" &&
		!Array.isArray(event.data) &&
		Object.keys(event.data).length === 1 &&
		event.data.type === "SKIP_WAITING"
	) {
		event.waitUntil(self.skipWaiting());
	}
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();

	event.waitUntil(
		(async () => {
			const path =
				event.notification.data?.url === "/main/setting/app" ? "/main/setting/app" : "/main";
			const targetUrl = new URL(path, self.location.origin).href;
			const windowClients = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});

			for (const client of windowClients) {
				if (new URL(client.url).origin !== self.location.origin) {
					continue;
				}
				if (typeof client.navigate === "function") {
					await client.navigate(targetUrl);
				}
				return client.focus();
			}

			return self.clients.openWindow(targetUrl);
		})()
	);
});

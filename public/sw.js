const PUSH_PAYLOAD_KEYS = ["badgeCount", "insertedCount", "runId", "source", "type", "url", "v"];
const SOURCE_LABELS = {
	arcalive: "Arcalive",
	battlepage: "Battlepage",
	insagirl: "Insagirl",
};

function isPositiveInteger(value) {
	return Number.isSafeInteger(value) && value > 0;
}

function isValidPayload(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const keys = Object.keys(value).sort();
	if (
		keys.length !== PUSH_PAYLOAD_KEYS.length ||
		keys.some((key, index) => key !== PUSH_PAYLOAD_KEYS[index])
	) {
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

	if (!isValidPayload(payload)) {
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

self.addEventListener("notificationclick", (event) => {
	event.notification.close();

	event.waitUntil(
		(async () => {
			const targetUrl = new URL("/main", self.location.origin).href;
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

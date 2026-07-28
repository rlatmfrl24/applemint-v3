import { describe, expect, it } from "vitest";
import { resolveNotificationStatus } from "./page";

const base = {
	configurationEnabled: true,
	configurationLoaded: true,
	supported: true,
	iosInstallRequired: false,
	permission: "default" as NotificationPermission,
	subscribed: false,
};

describe("앱 알림 상태", () => {
	it.each([
		[{ configurationLoaded: false }, "확인 중"],
		[{ configurationEnabled: false }, "서버 설정 중단"],
		[{ supported: false }, "미지원"],
		[{ iosInstallRequired: true }, "설치 필요"],
		[{ supported: false, iosInstallRequired: true }, "설치 필요"],
		[{ permission: "denied" }, "차단"],
		[{ permission: "granted", subscribed: true }, "활성화"],
		[{ permission: "granted", subscribed: false }, "권한 미결정"],
	] as const)("%s 조건을 %s 상태로 표시한다", (override, expected) => {
		expect(resolveNotificationStatus({ ...base, ...override })).toBe(expected);
	});
});

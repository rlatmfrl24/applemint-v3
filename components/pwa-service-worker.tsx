"use client";

import { useEffect } from "react";
import { type BeforeInstallPromptEvent, installPromptStore } from "@/lib/pwa-install";

export function PwaServiceWorker() {
	useEffect(() => {
		const handleBeforeInstallPrompt = (event: Event) => {
			installPromptStore.capture(event as BeforeInstallPromptEvent);
		};
		const handleAppInstalled = () => installPromptStore.markInstalled();
		window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
		window.addEventListener("appinstalled", handleAppInstalled);

		if (!("serviceWorker" in navigator)) {
			return () => {
				window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
				window.removeEventListener("appinstalled", handleAppInstalled);
			};
		}

		navigator.serviceWorker
			.register("/sw.js", {
				scope: "/",
				updateViaCache: "none",
			})
			.catch(() => {
				// 설치 실패는 웹 앱 사용을 막지 않는다. 상태는 앱 설정 화면에서 다시 확인한다.
			});

		return () => {
			window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
			window.removeEventListener("appinstalled", handleAppInstalled);
		};
	}, []);

	return null;
}

"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type BeforeInstallPromptEvent, installPromptStore } from "@/lib/pwa-install";
import { monitorPwaUpdates, type PwaUpdateMonitor, type PwaUpdateWorker } from "@/lib/pwa-update";

export function PwaServiceWorker() {
	const [waitingWorker, setWaitingWorker] = useState<PwaUpdateWorker | null>(null);
	const updateMonitor = useRef<PwaUpdateMonitor | null>(null);

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

		let disposed = false;
		navigator.serviceWorker
			.register("/sw.js", {
				scope: "/",
				updateViaCache: "none",
			})
			.then((registration) => {
				if (disposed) return;
				updateMonitor.current = monitorPwaUpdates(registration, navigator.serviceWorker, document, {
					onUpdateReady: setWaitingWorker,
				});
			})
			.catch(() => {
				// 설치 실패는 웹 앱 사용을 막지 않는다. 상태는 앱 설정 화면에서 다시 확인한다.
			});

		return () => {
			disposed = true;
			updateMonitor.current?.dispose();
			updateMonitor.current = null;
			window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
			window.removeEventListener("appinstalled", handleAppInstalled);
		};
	}, []);

	if (!waitingWorker) return null;

	return (
		<div
			role="status"
			className="fixed right-4 bottom-4 left-4 z-50 mx-auto flex max-w-lg items-center justify-between gap-4 rounded-xl border bg-background p-4 shadow-lg"
		>
			<div>
				<p className="font-medium text-sm">새 버전이 준비되었습니다</p>
				<p className="mt-1 text-muted-foreground text-xs">
					업데이트를 누르면 최신 버전으로 다시 시작합니다.
				</p>
			</div>
			<Button
				type="button"
				size="sm"
				onClick={() => updateMonitor.current?.requestUpdate(waitingWorker)}
			>
				<RefreshCw aria-hidden="true" className="mr-1 size-3.5" />
				업데이트
			</Button>
		</div>
	);
}

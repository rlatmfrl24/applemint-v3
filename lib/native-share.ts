export interface ShareableThread {
	title?: string | null;
	url: string;
}

interface NativeShareNavigator {
	share?: (data: ShareData) => Promise<void>;
}

export function createThreadSharePayload(thread: ShareableThread): ShareData {
	return {
		title: thread.title ?? "Applemint 링크",
		url: thread.url,
	};
}

export function isNativeShareSupported(navigatorTarget: NativeShareNavigator) {
	return typeof navigatorTarget.share === "function";
}

export async function shareThread(
	navigatorTarget: NativeShareNavigator,
	thread: ShareableThread
): Promise<"shared" | "dismissed"> {
	if (!navigatorTarget.share) {
		throw new Error("이 브라우저에서는 공유 기능을 사용할 수 없습니다.");
	}

	try {
		await navigatorTarget.share(createThreadSharePayload(thread));
		return "shared";
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return "dismissed";
		}
		throw error;
	}
}

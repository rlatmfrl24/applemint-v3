"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
	BellOff,
	BellRing,
	CheckCircle2,
	Download,
	ExternalLink,
	Loader2,
	ShieldAlert,
	Smartphone,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { PushConfiguration } from "@/contracts/push.schema";
import {
	activatePushNotifications,
	deactivatePushNotifications,
	getCurrentPushSubscription,
	isIosDevice,
	isStandaloneDisplay,
	isWebPushSupported,
} from "@/lib/pwa-client";
import { installPromptStore } from "@/lib/pwa-install";
import { useTRPC } from "@/trpc/client";
import {
	SettingsPageHeader,
	SettingsStatusItem,
	SettingsStatusStrip,
	SettingsSurface,
} from "../admin-ui";

type NotificationStatus =
	| "확인 중"
	| "미지원"
	| "설치 필요"
	| "권한 미결정"
	| "활성화"
	| "차단"
	| "서버 설정 중단";

export function resolveNotificationStatus({
	configurationEnabled,
	configurationLoaded,
	supported,
	iosInstallRequired,
	permission,
	subscribed,
}: {
	configurationEnabled: boolean;
	configurationLoaded: boolean;
	supported: boolean;
	iosInstallRequired: boolean;
	permission: NotificationPermission;
	subscribed: boolean;
}): NotificationStatus {
	if (!configurationLoaded) return "확인 중";
	if (!configurationEnabled) return "서버 설정 중단";
	if (iosInstallRequired) return "설치 필요";
	if (!supported) return "미지원";
	if (permission === "denied") return "차단";
	if (permission === "granted" && subscribed) return "활성화";
	return "권한 미결정";
}

function notificationDescription(status: NotificationStatus) {
	switch (status) {
		case "미지원":
			return "이 브라우저에서는 Web Push를 사용할 수 없습니다.";
		case "설치 필요":
			return "iPhone과 iPad에서는 먼저 홈 화면에 Applemint를 추가해야 합니다.";
		case "권한 미결정":
			return "버튼을 누를 때만 브라우저 알림 권한을 요청합니다.";
		case "활성화":
			return "예약 수집에서 신규 아이템이 생기면 실행별 요약 알림을 받습니다.";
		case "차단":
			return "브라우저 또는 OS 설정에서 Applemint 알림 권한을 직접 허용해주세요.";
		case "서버 설정 중단":
			return "서버 발송 설정이 꺼져 있어 신규 구독과 알림 발송을 중단했습니다.";
		default:
			return "현재 기기의 알림 상태를 확인하고 있습니다.";
	}
}

function notificationTone(status: NotificationStatus) {
	if (status === "활성화") return "success" as const;
	if (status === "차단" || status === "서버 설정 중단") return "danger" as const;
	if (status === "설치 필요" || status === "권한 미결정") return "warning" as const;
	return "neutral" as const;
}

function notificationIcon(status: NotificationStatus): ReactNode {
	if (status === "차단") return <ShieldAlert aria-hidden="true" className="size-5" />;
	if (status === "활성화") return <CheckCircle2 aria-hidden="true" className="size-5" />;
	return <BellRing aria-hidden="true" className="size-5" />;
}

function installDescription({
	ios,
	standalone,
	promptAvailable,
}: {
	ios: boolean;
	standalone: boolean;
	promptAvailable: boolean;
}) {
	if (ios && !standalone) return "Safari 공유 메뉴에서 ‘홈 화면에 추가’를 선택해주세요.";
	if (promptAvailable) return "브라우저가 Applemint 설치를 지원합니다.";
	if (standalone) return "standalone 모드로 실행 중입니다.";
	return "주소창 또는 브라우저 메뉴의 앱 설치 기능을 이용해주세요.";
}

interface Feedback {
	success: boolean;
	message: string;
}

function usePwaBrowserState() {
	const [standalone, setStandalone] = useState(false);
	const [ios, setIos] = useState(false);
	const [supported, setSupported] = useState(false);
	const [permission, setPermission] = useState<NotificationPermission>("default");
	const [subscription, setSubscription] = useState<PushSubscription | null>(null);

	const refresh = useCallback(async () => {
		const nextSupported = isWebPushSupported();
		setStandalone(isStandaloneDisplay());
		setIos(isIosDevice());
		setSupported(nextSupported);
		if (!nextSupported) return;
		setPermission(Notification.permission);
		setSubscription(await getCurrentPushSubscription().catch(() => null));
	}, []);

	useEffect(() => {
		refresh().catch(() => undefined);
	}, [refresh]);

	return {
		standalone,
		ios,
		supported,
		permission,
		subscription,
		setPermission,
		setSubscription,
		refresh,
	};
}

function useInstallAction(
	refreshBrowserState: () => Promise<void>,
	setFeedback: (feedback: Feedback | null) => void
) {
	const [pending, setPending] = useState(false);

	const install = async () => {
		setFeedback(null);
		setPending(true);
		try {
			const outcome = await installPromptStore.prompt();
			if (outcome === "accepted") {
				setFeedback({ success: true, message: "Applemint 설치를 시작했습니다." });
			} else if (outcome === "dismissed") {
				setFeedback({ success: false, message: "설치 요청을 닫았습니다." });
			}
		} finally {
			setPending(false);
			await refreshBrowserState();
		}
	};

	return { install, pending };
}

function useNotificationActions({
	configuration,
	supported,
	subscription,
	setPermission,
	setSubscription,
	refreshBrowserState,
	setFeedback,
}: {
	configuration: PushConfiguration | undefined;
	supported: boolean;
	subscription: PushSubscription | null;
	setPermission: (permission: NotificationPermission) => void;
	setSubscription: (subscription: PushSubscription | null) => void;
	refreshBrowserState: () => Promise<void>;
	setFeedback: (feedback: Feedback | null) => void;
}) {
	const trpc = useTRPC();
	const subscribeMutation = useMutation(trpc.push.subscribe.mutationOptions());
	const unsubscribeMutation = useMutation(trpc.push.unsubscribe.mutationOptions());

	const enable = async () => {
		if (!configuration?.enabled || !configuration.publicKey || !supported) return;
		setFeedback(null);

		try {
			const result = await activatePushNotifications(configuration.publicKey, (input) =>
				subscribeMutation.mutateAsync(input)
			);
			setPermission(result.permission);
			if (!result.subscription) {
				setFeedback({
					success: false,
					message: "알림 권한이 허용되지 않았습니다. 브라우저 설정을 확인해주세요.",
				});
				return;
			}

			setSubscription(result.subscription);
			setFeedback({ success: true, message: "이 기기의 신규 아이템 알림을 활성화했습니다." });
		} catch (error) {
			setSubscription(await getCurrentPushSubscription().catch(() => null));
			setFeedback({
				success: false,
				message: error instanceof Error ? error.message : "알림을 활성화하지 못했습니다.",
			});
		}
	};

	const disable = async () => {
		if (!subscription) return;
		setFeedback(null);
		try {
			await deactivatePushNotifications(subscription, (endpoint) =>
				unsubscribeMutation.mutateAsync({ endpoint })
			);
			setSubscription(null);
			setFeedback({ success: true, message: "이 기기의 알림과 앱 아이콘 badge를 해제했습니다." });
		} catch (error) {
			setFeedback({
				success: false,
				message: error instanceof Error ? error.message : "알림을 비활성화하지 못했습니다.",
			});
			await refreshBrowserState();
		}
	};

	return {
		enable,
		disable,
		busy: subscribeMutation.isPending || unsubscribeMutation.isPending,
	};
}

function PwaStatusStrip({
	installStatus,
	notificationStatus,
}: {
	installStatus: string;
	notificationStatus: NotificationStatus;
}) {
	return (
		<SettingsStatusStrip className="md:grid-cols-2">
			<SettingsStatusItem
				icon={<Smartphone aria-hidden="true" className="size-5" />}
				label="PWA 설치"
				value={installStatus}
				supporting="현재 브라우저와 기기 기준"
				tone={installStatus === "설치됨" ? "success" : "neutral"}
			/>
			<SettingsStatusItem
				icon={
					notificationStatus === "활성화" ? (
						<BellRing aria-hidden="true" className="size-5" />
					) : (
						<BellOff aria-hidden="true" className="size-5" />
					)
				}
				label="신규 아이템 알림"
				value={notificationStatus}
				supporting="이 기기의 구독과 badge만 관리"
				tone={notificationTone(notificationStatus)}
			/>
		</SettingsStatusStrip>
	);
}

function InstallSurface({
	installStatus,
	ios,
	standalone,
	promptAvailable,
	pending,
	onInstall,
}: {
	installStatus: string;
	ios: boolean;
	standalone: boolean;
	promptAvailable: boolean;
	pending: boolean;
	onInstall: () => Promise<void>;
}) {
	const showButton = promptAvailable && !standalone;
	return (
		<SettingsSurface
			className="mt-6"
			title="Applemint 설치"
			description="설치는 자동으로 열리지 않으며 아래 안내 또는 버튼으로 직접 시작합니다."
			contentClassName="p-4 sm:p-5"
		>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-start gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
						<Download aria-hidden="true" className="size-5" />
					</div>
					<div>
						<h3 className="font-medium text-sm">
							{installStatus === "설치됨" ? "홈 화면 앱으로 실행 중" : "홈 화면에 설치"}
						</h3>
						<p className="mt-1 text-muted-foreground text-sm leading-6">
							{installDescription({ ios, standalone, promptAvailable })}
						</p>
					</div>
				</div>
				{showButton ? (
					<Button onClick={onInstall} disabled={pending}>
						{pending ? (
							<Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						) : (
							<Download aria-hidden="true" className="mr-2 size-4" />
						)}
						설치
					</Button>
				) : null}
			</div>
		</SettingsSurface>
	);
}

function NotificationSurface({
	status,
	canEnable,
	canDisable,
	busy,
	onEnable,
	onDisable,
}: {
	status: NotificationStatus;
	canEnable: boolean;
	canDisable: boolean;
	busy: boolean;
	onEnable: () => Promise<void>;
	onDisable: () => Promise<void>;
}) {
	return (
		<SettingsSurface
			className="mt-6"
			title="신규 아이템 알림"
			description="예약 수집 실행에서 새 아이템이 생긴 경우에만 source와 개수를 알립니다."
			contentClassName="p-4 sm:p-5"
		>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-start gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
						{notificationIcon(status)}
					</div>
					<div>
						<h3 className="font-medium text-sm">{status}</h3>
						<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
							{notificationDescription(status)}
						</p>
					</div>
				</div>
				{canEnable ? (
					<Button onClick={onEnable} disabled={busy}>
						{busy ? (
							<Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						) : (
							<BellRing aria-hidden="true" className="mr-2 size-4" />
						)}
						알림 활성화
					</Button>
				) : null}
				{canDisable ? (
					<Button variant="outline" onClick={onDisable} disabled={busy}>
						알림 비활성화
					</Button>
				) : null}
			</div>

			{status === "차단" ? (
				<a
					className="mt-4 inline-flex items-center gap-1 text-muted-foreground text-xs underline underline-offset-4"
					href="https://support.google.com/chrome/answer/3220216"
					target="_blank"
					rel="noreferrer"
				>
					브라우저 알림 설정 안내
					<ExternalLink aria-hidden="true" className="size-3" />
				</a>
			) : null}
		</SettingsSurface>
	);
}

function PageFeedback({ error, feedback }: { error: Error | null; feedback: Feedback | null }) {
	return (
		<>
			{error ? (
				<Alert className="mt-6" variant="destructive">
					<AlertTitle>알림 서버 상태를 확인하지 못했습니다.</AlertTitle>
					<AlertDescription>{error.message}</AlertDescription>
				</Alert>
			) : null}
			{feedback ? (
				<Alert className="mt-6" variant={feedback.success ? "default" : "destructive"}>
					<AlertTitle>{feedback.success ? "완료" : "확인 필요"}</AlertTitle>
					<AlertDescription>{feedback.message}</AlertDescription>
				</Alert>
			) : null}
		</>
	);
}

export default function AppNotificationSettingPage() {
	const trpc = useTRPC();
	const installSnapshot = useSyncExternalStore(
		installPromptStore.subscribe,
		installPromptStore.getSnapshot,
		installPromptStore.getServerSnapshot
	);
	const configuration = useQuery(trpc.push.configuration.queryOptions());
	const browser = usePwaBrowserState();
	const [feedback, setFeedback] = useState<Feedback | null>(null);
	const installAction = useInstallAction(browser.refresh, setFeedback);
	const notificationActions = useNotificationActions({
		configuration: configuration.data,
		supported: browser.supported,
		subscription: browser.subscription,
		setPermission: browser.setPermission,
		setSubscription: browser.setSubscription,
		refreshBrowserState: browser.refresh,
		setFeedback,
	});
	const installStatus =
		browser.standalone || installSnapshot.installCompleted ? "설치됨" : "설치 안 됨";
	const notificationStatus = resolveNotificationStatus({
		configurationEnabled: configuration.data?.enabled ?? false,
		configurationLoaded: configuration.isSuccess,
		supported: browser.supported,
		iosInstallRequired: browser.ios && !browser.standalone,
		permission: browser.permission,
		subscribed: browser.subscription !== null,
	});
	const canEnable =
		notificationStatus === "권한 미결정" &&
		configuration.data?.enabled === true &&
		browser.permission !== "denied";

	return (
		<section aria-labelledby="app-notification-settings-heading">
			<SettingsPageHeader
				title="앱 및 알림"
				description="현재 기기에 Applemint를 설치하고 예약 수집 신규 아이템 알림을 관리합니다."
			/>
			<h2 className="sr-only" id="app-notification-settings-heading">
				앱 및 알림 설정
			</h2>
			<PwaStatusStrip installStatus={installStatus} notificationStatus={notificationStatus} />
			<InstallSurface
				installStatus={installStatus}
				ios={browser.ios}
				standalone={browser.standalone}
				promptAvailable={installSnapshot.promptAvailable}
				pending={installAction.pending}
				onInstall={installAction.install}
			/>
			<NotificationSurface
				status={notificationStatus}
				canEnable={canEnable}
				canDisable={browser.subscription !== null}
				busy={notificationActions.busy}
				onEnable={notificationActions.enable}
				onDisable={notificationActions.disable}
			/>
			<PageFeedback
				error={configuration.error instanceof Error ? configuration.error : null}
				feedback={feedback}
			/>
		</section>
	);
}

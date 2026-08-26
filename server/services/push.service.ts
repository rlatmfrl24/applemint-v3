import type { PushSendTestResult, PushSubscriptionInput } from "@/contracts/push.schema";
import { DomainError } from "@/server/errors/domain-error";
import type { PushStore } from "@/server/ports/push.store";
import { getWebPushServerConfiguration } from "@/server/push/configuration";

export type PushTestSender = (endpoint: string) => Promise<PushSendTestResult>;

const unavailablePushTestSender: PushTestSender = async () => {
	throw new DomainError(
		"ConfigurationUnavailable",
		"Web Push 테스트 처리 경로가 준비되지 않았습니다.",
		{ reasonCode: "push-test-route-missing" }
	);
};

export class PushService {
	constructor(
		private readonly store: PushStore,
		private readonly sendTestNotification: PushTestSender = unavailablePushTestSender
	) {}

	configuration() {
		return getWebPushServerConfiguration().public;
	}

	subscribe(input: PushSubscriptionInput) {
		const configuration = getWebPushServerConfiguration();
		if (!configuration.enabled) {
			throw new DomainError("ConfigurationUnavailable", "Web Push 서버 설정이 중단되어 있습니다.", {
				reasonCode: configuration.public.reason ?? "configuration-missing",
			});
		}
		return this.store.subscribe(input);
	}

	status(endpoint: string) {
		return this.store.status(endpoint);
	}

	unsubscribe(endpoint: string) {
		return this.store.unsubscribe(endpoint);
	}

	acknowledgeInbox(endpoint: string) {
		return this.store.acknowledgeInbox(endpoint);
	}

	sendTest(endpoint: string) {
		const configuration = getWebPushServerConfiguration();
		if (!configuration.enabled) {
			throw new DomainError("ConfigurationUnavailable", "Web Push 서버 설정이 중단되어 있습니다.", {
				reasonCode: configuration.public.reason ?? "configuration-missing",
			});
		}
		return this.sendTestNotification(endpoint);
	}
}

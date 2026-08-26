import type { PushSubscriptionInput } from "@/contracts/push.schema";
import { DomainError } from "@/server/errors/domain-error";
import type { PushStore } from "@/server/ports/push.store";
import { getWebPushServerConfiguration } from "@/server/push/configuration";

const sendWebPushTest = async (
	endpoint: string,
	configuration: Extract<ReturnType<typeof getWebPushServerConfiguration>, { enabled: true }>
) => (await import("@/server/push/test-sender")).sendWebPushTest(endpoint, configuration);

export class PushService {
	constructor(
		private readonly store: PushStore,
		private readonly sendTestNotification = sendWebPushTest
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
		return this.sendTestNotification(endpoint, configuration);
	}
}

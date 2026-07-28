import type { PushSubscriptionInput } from "@/contracts/push.schema";
import { DomainError } from "@/server/errors/domain-error";
import { getWebPushServerConfiguration } from "@/server/push/configuration";
import type { PushRepository } from "@/server/repositories/push.repository";

export class PushService {
	constructor(private readonly repository: PushRepository) {}

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
		return this.repository.subscribe(input);
	}

	status(endpoint: string) {
		return this.repository.status(endpoint);
	}

	unsubscribe(endpoint: string) {
		return this.repository.unsubscribe(endpoint);
	}

	acknowledgeInbox(endpoint: string) {
		return this.repository.acknowledgeInbox(endpoint);
	}
}

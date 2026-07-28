import type { SupabaseClient } from "@supabase/supabase-js";
import {
	type PushSubscriptionInput,
	pushAcknowledgeResultSchema,
	pushSubscribeResultSchema,
	pushSubscriptionStatusSchema,
	pushUnsubscribeResultSchema,
} from "@/contracts/push.schema";
import { unexpectedFailure } from "@/server/errors/domain-error";
import { mapPostgrestError } from "@/server/errors/error-mapper";
import type { RequestMetrics } from "@/server/observability/request-metrics";

export class PushRepository {
	constructor(
		private readonly supabase: SupabaseClient,
		private readonly metrics?: RequestMetrics
	) {}

	private measure<T>(operation: string, run: () => Promise<T>) {
		return this.metrics?.measureRepository(operation, run) ?? run();
	}

	async subscribe(input: PushSubscriptionInput) {
		return this.measure("push.subscribe", async () => {
			const { data, error } = await this.supabase.rpc("upsert_web_push_subscription", {
				p_endpoint: input.endpoint,
				p_p256dh: input.keys.p256dh,
				p_auth: input.keys.auth,
				p_expiration_time:
					input.expirationTime === null ? null : new Date(input.expirationTime).toISOString(),
			});
			if (error) throw mapPostgrestError(error, "알림 구독을 저장하지 못했습니다.");

			const parsed = pushSubscribeResultSchema.safeParse(data);
			if (!parsed.success) {
				throw unexpectedFailure("알림 구독 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}

	async status(endpoint: string) {
		return this.measure("push.status", async () => {
			const { data, error } = await this.supabase.rpc("get_web_push_subscription_status", {
				p_endpoint: endpoint,
			});
			if (error) throw mapPostgrestError(error, "알림 구독 상태를 확인하지 못했습니다.");

			const parsed = pushSubscriptionStatusSchema.safeParse(data);
			if (!parsed.success) {
				throw unexpectedFailure("알림 구독 상태 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}

	async unsubscribe(endpoint: string) {
		return this.measure("push.unsubscribe", async () => {
			const { data, error } = await this.supabase.rpc("disable_web_push_subscription", {
				p_endpoint: endpoint,
			});
			if (error) throw mapPostgrestError(error, "알림 구독을 중단하지 못했습니다.");

			const parsed = pushUnsubscribeResultSchema.safeParse(data);
			if (!parsed.success) {
				throw unexpectedFailure("알림 구독 중단 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}

	async acknowledgeInbox(endpoint: string) {
		return this.measure("push.acknowledgeInbox", async () => {
			const { data, error } = await this.supabase.rpc("acknowledge_web_push_inbox", {
				p_endpoint: endpoint,
			});
			if (error) throw mapPostgrestError(error, "Inbox 확인 상태를 저장하지 못했습니다.");

			const parsed = pushAcknowledgeResultSchema.safeParse(data);
			if (!parsed.success) {
				throw unexpectedFailure("Inbox 확인 응답이 올바르지 않습니다.", parsed.error);
			}
			return parsed.data;
		});
	}
}

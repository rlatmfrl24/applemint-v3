import type { z } from "zod";
import type {
	PushSubscriptionInput,
	pushAcknowledgeResultSchema,
	pushSubscribeResultSchema,
	pushSubscriptionStatusSchema,
	pushUnsubscribeResultSchema,
} from "@/contracts/push.schema";

export interface PushStore {
	subscribe(input: PushSubscriptionInput): Promise<z.output<typeof pushSubscribeResultSchema>>;
	status(endpoint: string): Promise<z.output<typeof pushSubscriptionStatusSchema>>;
	unsubscribe(endpoint: string): Promise<z.output<typeof pushUnsubscribeResultSchema>>;
	acknowledgeInbox(endpoint: string): Promise<z.output<typeof pushAcknowledgeResultSchema>>;
}

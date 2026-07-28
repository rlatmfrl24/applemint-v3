import {
	pushAcknowledgeResultSchema,
	pushConfigurationSchema,
	pushEndpointInputSchema,
	pushSubscribeResultSchema,
	pushSubscriptionInputSchema,
	pushSubscriptionStatusSchema,
	pushUnsubscribeResultSchema,
} from "@/contracts/push.schema";
import { createTRPCRouter, ownerProcedure } from "../init";

export const pushRouter = createTRPCRouter({
	configuration: ownerProcedure
		.output(pushConfigurationSchema)
		.query(({ ctx }) => ctx.services.push.configuration()),
	subscribe: ownerProcedure
		.input(pushSubscriptionInputSchema)
		.output(pushSubscribeResultSchema)
		.mutation(({ ctx, input }) => ctx.services.push.subscribe(input)),
	status: ownerProcedure
		.input(pushEndpointInputSchema)
		.output(pushSubscriptionStatusSchema)
		.query(({ ctx, input }) => ctx.services.push.status(input.endpoint)),
	unsubscribe: ownerProcedure
		.input(pushEndpointInputSchema)
		.output(pushUnsubscribeResultSchema)
		.mutation(({ ctx, input }) => ctx.services.push.unsubscribe(input.endpoint)),
	acknowledgeInbox: ownerProcedure
		.input(pushEndpointInputSchema)
		.output(pushAcknowledgeResultSchema)
		.mutation(({ ctx, input }) => ctx.services.push.acknowledgeInbox(input.endpoint)),
});

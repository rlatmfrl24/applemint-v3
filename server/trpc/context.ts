import { resolveRequestId as resolveHeaderRequestId } from "@/lib/request-id";
import { RequestMetrics } from "@/server/observability/request-metrics";
import { createServices } from "@/server/services";
import type { AuthenticatedAccessResult } from "@/utils/supabase/auth-access";
import { checkAuthenticatedAccess } from "@/utils/supabase/auth-access";
import type { OwnerAccessResult } from "@/utils/supabase/owner-access";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

export function resolveRequestId(request: Request) {
	return resolveHeaderRequestId(request.headers);
}

export async function createTRPCContext(request: Request, requestId = resolveRequestId(request)) {
	const supabase = await createClient();
	const metrics = new RequestMetrics();
	const services = createServices(supabase, metrics);
	let authenticatedAccessPromise: Promise<AuthenticatedAccessResult> | undefined;
	let ownerAccessPromise: Promise<OwnerAccessResult> | undefined;

	return {
		requestId,
		metrics,
		services,
		getAuthenticatedAccess() {
			authenticatedAccessPromise ??= checkAuthenticatedAccess(supabase, metrics);
			return authenticatedAccessPromise;
		},
		getOwnerAccess() {
			ownerAccessPromise ??= checkApplemintOwner(supabase, metrics);
			return ownerAccessPromise;
		},
	};
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

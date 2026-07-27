import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { resolveRequestId } from "@/lib/request-id";
import { RequestMetrics } from "@/server/observability/request-metrics";
import { createServices } from "@/server/services";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";

export async function createMainServerContext() {
	const requestHeaders = await headers();
	const requestId = resolveRequestId(requestHeaders);
	const supabase = await createClient();
	const metrics = new RequestMetrics();
	const ownerAccess = await checkApplemintOwner(supabase, metrics);

	if (ownerAccess.kind === "unauthenticated") {
		redirect("/login");
	}
	if (ownerAccess.kind === "forbidden") {
		redirect("/signout");
	}
	if (ownerAccess.kind === "unavailable") {
		throw new Error(ownerAccess.message);
	}

	return {
		requestId,
		metrics,
		services: createServices(supabase, metrics),
		email: typeof ownerAccess.claims.email === "string" ? ownerAccess.claims.email : null,
	};
}

// layout과 page Server Component가 동일한 요청에서 인증·소유자 확인을 공유합니다.
export const getMainServerContext = cache(createMainServerContext);

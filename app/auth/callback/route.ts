import { NextResponse } from "next/server";
import { resolveRequestId } from "@/lib/request-id";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
	// The `/auth/callback` route is required for the server-side auth flow implemented
	// by the SSR package. It exchanges an auth code for the user's session.
	// https://supabase.com/docs/guides/auth/server-side/nextjs
	const requestUrl = new URL(request.url);
	const code = requestUrl.searchParams.get("code");
	const origin = requestUrl.origin;
	const requestId = resolveRequestId(request.headers);
	const startedAt = performance.now();
	let authCallCount = 0;
	let authDurationMs = 0;
	let outcome: "succeeded" | "failed" = "succeeded";
	let errorCode: string | null = null;

	if (code) {
		const supabase = await createClient();
		const authStartedAt = performance.now();
		authCallCount = 1;
		try {
			const { error } = await supabase.auth.exchangeCodeForSession(code);
			if (error) {
				outcome = "failed";
				errorCode = "auth-code-exchange-failed";
			}
		} catch (error) {
			outcome = "failed";
			errorCode = "auth-code-exchange-failed";
			console.error({
				requestId,
				transport: "auth-callback",
				operation: "auth.exchangeCodeForSession",
				batchSize: 1,
				requestDurationMs: Math.round(performance.now() - startedAt),
				authCallCount,
				authDurationMs: Math.round(performance.now() - authStartedAt),
				downstreamCallCount: authCallCount,
				responseBytes: 0,
				resultCount: 0,
				outcome,
				errorCode,
			});
			throw error;
		} finally {
			authDurationMs = Math.round(performance.now() - authStartedAt);
		}
	}

	// URL to redirect to after sign up process completes
	const response = NextResponse.redirect(`${origin}/main`);
	response.headers.set("cache-control", "private, no-store");
	response.headers.set("expires", "0");
	response.headers.set("pragma", "no-cache");
	response.headers.set("x-request-id", requestId);
	console.info({
		requestId,
		transport: "auth-callback",
		operation: "auth.exchangeCodeForSession",
		batchSize: 1,
		requestDurationMs: Math.round(performance.now() - startedAt),
		authCallCount,
		authDurationMs,
		downstreamCallCount: authCallCount,
		responseBytes: 0,
		resultCount: 0,
		outcome,
		errorCode,
	});
	return response;
}

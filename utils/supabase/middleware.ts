import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { resolveRequestId } from "@/lib/request-id";

const FORWARDED_HEADER_ALLOWLIST = [
	"accept-language",
	"content-length",
	"content-type",
	"cookie",
	"host",
	"user-agent",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-port",
	"x-forwarded-proto",
	"x-real-ip",
] as const;

export const getAllowedRequestHeaders = (request: NextRequest, requestId?: string) => {
	const headers = new Headers();

	for (const headerName of FORWARDED_HEADER_ALLOWLIST) {
		const value = request.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}

	if (requestId) {
		headers.set("x-request-id", requestId);
	}

	return headers;
};

const createForwardedResponse = (request: NextRequest, requestId: string) => {
	const response = NextResponse.next({
		request: {
			headers: getAllowedRequestHeaders(request, requestId),
		},
	});
	response.headers.set("cache-control", "private, no-store");
	response.headers.set("x-request-id", requestId);
	return response;
};

export const updateSession = async (request: NextRequest) => {
	const requestId = resolveRequestId(request.headers);
	const requestStartedAt = performance.now();
	let authStartedAt: number | null = null;
	let authDurationMs = 0;
	let authOutcome: "skipped" | "succeeded" | "unauthenticated" | "failed" = "skipped";

	try {
		// Forward only request headers needed by downstream logic.
		// `cookie` must be preserved for Supabase SSR auth in route handlers/server components.
		let response = createForwardedResponse(request, requestId);
		const pendingCookies = new Map<
			string,
			{ name: string; value: string; options: CookieOptions }
		>();
		const authHeaders = new Headers();
		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
		const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

		if (!supabaseUrl || !supabasePublishableKey) {
			return response;
		}

		const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
			cookies: {
				getAll() {
					return request.cookies.getAll().map(({ name, value }) => ({ name, value }));
				},
				setAll(cookiesToSet, headers) {
					for (const cookie of cookiesToSet) {
						request.cookies.set(cookie.name, cookie.value);
						pendingCookies.set(cookie.name, cookie);
					}
					for (const [name, value] of Object.entries(headers)) {
						authHeaders.set(name, value);
					}

					response = createForwardedResponse(request, requestId);
					for (const cookie of pendingCookies.values()) {
						response.cookies.set(cookie.name, cookie.value, cookie.options);
					}
					authHeaders.forEach((value, name) => {
						response.headers.set(name, value);
					});
				},
			},
		});

		// Validate claims early so an expired session can be refreshed before the response is committed.
		// https://supabase.com/docs/guides/auth/server-side/nextjs
		authStartedAt = performance.now();
		const { data, error } = await supabase.auth.getClaims();
		authDurationMs = performance.now() - authStartedAt;
		authOutcome = error ? "failed" : data?.claims ? "succeeded" : "unauthenticated";

		return response;
	} catch (_error) {
		if (authStartedAt !== null) authDurationMs = performance.now() - authStartedAt;
		authOutcome = "failed";
		// 인증 인프라 오류가 발생해도 요청 헤더는 허용목록으로 제한해 전달합니다.
		return createForwardedResponse(request, requestId);
	} finally {
		console.info({
			requestId,
			transport: "next-middleware",
			operation: "auth.getClaims",
			batchSize: 1,
			requestDurationMs: Math.round(performance.now() - requestStartedAt),
			authCallCount: authStartedAt === null ? 0 : 1,
			authDurationMs: Math.round(authDurationMs),
			downstreamCallCount: authStartedAt === null ? 0 : 1,
			outcome: authOutcome,
			errorCode:
				authOutcome === "failed"
					? "auth-validation-failed"
					: authOutcome === "unauthenticated"
						? "auth-claims-missing"
						: null,
		});
	}
};

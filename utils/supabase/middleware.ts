import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const FORWARDED_HEADER_ALLOWLIST = [
	"accept-language",
	"host",
	"user-agent",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-port",
	"x-forwarded-proto",
	"x-real-ip",
] as const;

const getAllowedRequestHeaders = (request: NextRequest) => {
	const headers = new Headers();

	for (const headerName of FORWARDED_HEADER_ALLOWLIST) {
		const value = request.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}

	return headers;
};

const createForwardedResponse = (request: NextRequest) =>
	NextResponse.next({
		request: {
			headers: getAllowedRequestHeaders(request),
		},
	});

export const updateSession = async (request: NextRequest) => {
	// This `try/catch` block is only here for the interactive tutorial.
	// Feel free to remove once you have Supabase connected.
	try {
		// Forward only non-sensitive request headers needed by downstream logic.
		let response = createForwardedResponse(request);

		const supabase = createServerClient(
			process.env.NEXT_PUBLIC_SUPABASE_URL!,
			process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
			{
				cookies: {
					get(name: string) {
						return request.cookies.get(name)?.value;
					},
					set(name: string, value: string, options: CookieOptions) {
						// If the cookie is updated, update the cookies for the request and response
						request.cookies.set({
							name,
							value,
							...options,
						});
						response = createForwardedResponse(request);
						response.cookies.set({
							name,
							value,
							...options,
						});
					},
					remove(name: string, options: CookieOptions) {
						// If the cookie is removed, update the cookies for the request and response
						request.cookies.set({
							name,
							value: "",
							...options,
						});
						response = createForwardedResponse(request);
						response.cookies.set({
							name,
							value: "",
							...options,
						});
					},
				},
			}
		);

		// This will refresh session if expired - required for Server Components
		// https://supabase.com/docs/guides/auth/server-side/nextjs
		await supabase.auth.getUser();

		return response;
	} catch (_e) {
		// If you are here, a Supabase client could not be created!
		// This is likely because you have not set up environment variables.
		// Check out http://localhost:3000 for Next Steps.
		return createForwardedResponse(request);
	}
};

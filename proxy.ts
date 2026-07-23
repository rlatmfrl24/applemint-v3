import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

const INTERNAL_CRAWL_API_PATH = "/api/crawl/scheduled";

export async function proxy(request: NextRequest) {
	// 내부 크롤링 API는 쿠키 세션을 사용하지 않으며 원본 인증 헤더와 JSON body를 보존해야 한다.
	if (request.nextUrl.pathname === INTERNAL_CRAWL_API_PATH) {
		return NextResponse.next();
	}

	return await updateSession(request);
}

export const config = {
	matcher: [
		/*
		 * Match all request paths except:
		 * - _next/static (static files)
		 * - _next/image (image optimization files)
		 * - favicon.ico (favicon file)
		 * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
		 * Feel free to modify this pattern to include more paths.
		 */
		"/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
	],
};

import { type NextRequest, NextResponse } from "next/server";
import { getImgurEmbedTarget } from "@/lib/imgur-embed";
import { checkApplemintOwner } from "@/utils/supabase/owner-access";
import { createClient } from "@/utils/supabase/server";
import { getImgurPreviewImageUrl } from "./preview";

const MAX_EMBED_HTML_BYTES = 2_000_000;
const IMGUR_FETCH_TIMEOUT_MS = 7_000;
const PRIVATE_CACHE_CONTROL = "private, max-age=86400";

export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
	return NextResponse.json(
		{ error: message },
		{
			status,
			headers: { "Cache-Control": "no-store" },
		}
	);
}

export async function GET(request: NextRequest) {
	let ownerAccess: Awaited<ReturnType<typeof checkApplemintOwner>>;
	try {
		ownerAccess = await checkApplemintOwner(await createClient());
	} catch {
		return errorResponse("소유자 권한을 확인할 수 없습니다.", 503);
	}
	if (ownerAccess.kind !== "owner") {
		return errorResponse(ownerAccess.message, ownerAccess.status);
	}

	const sourceUrl = request.nextUrl.searchParams.get("url");
	const target = sourceUrl ? getImgurEmbedTarget(sourceUrl) : null;
	if (!target) {
		return errorResponse("지원하지 않는 Imgur URL입니다.", 400);
	}

	try {
		const response = await fetch(target.embedUrl, {
			headers: {
				Accept: "text/html,application/xhtml+xml",
				"User-Agent": "AppleMint-Imgur-Preview/1.0",
			},
			next: { revalidate: 86_400 },
			signal: AbortSignal.timeout(IMGUR_FETCH_TIMEOUT_MS),
		});
		if (!response.ok) {
			return errorResponse("Imgur 미리보기를 불러오지 못했습니다.", 502);
		}

		const contentLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(contentLength) && contentLength > MAX_EMBED_HTML_BYTES) {
			return errorResponse("Imgur 미리보기 응답이 너무 큽니다.", 502);
		}

		const html = await response.text();
		if (new TextEncoder().encode(html).byteLength > MAX_EMBED_HTML_BYTES) {
			return errorResponse("Imgur 미리보기 응답이 너무 큽니다.", 502);
		}

		const previewUrl = getImgurPreviewImageUrl(html);
		if (!previewUrl) {
			return errorResponse("Imgur 미리보기 이미지를 찾지 못했습니다.", 502);
		}

		return NextResponse.redirect(previewUrl, {
			status: 307,
			headers: {
				"Cache-Control": PRIVATE_CACHE_CONTROL,
				Vary: "Cookie",
			},
		});
	} catch {
		return errorResponse("Imgur 미리보기를 불러오지 못했습니다.", 502);
	}
}

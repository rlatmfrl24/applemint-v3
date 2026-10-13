import { type NextRequest, NextResponse } from "next/server";
import {
	hasMinimumInternalSecretLength,
	hasValidInternalSecret,
} from "@/app/api/crawl/internal-auth";
import { runBookmarkWorker } from "@/server/bookmarks/worker";
import { getInternalSecret } from "@/server/env/features";
import { observeHttpHandler } from "@/server/observability/http-request";
import { createServiceRoleClient } from "@/utils/supabase/service-role";

export const maxDuration = 60;
export const POST = observeHttpHandler<NextRequest>(
	{ transport: "internal-rest", operation: "bookmark.worker" },
	async (request) => {
		const secret = getInternalSecret();
		if (!hasMinimumInternalSecretLength(secret))
			return NextResponse.json(
				{ error: "worker 설정 필요", reason: "configuration-missing" },
				{ status: 503 }
			);
		if (!hasValidInternalSecret(request.headers.get("x-applemint-internal-secret"), secret))
			return NextResponse.json({ error: "인증되지 않은 worker 요청" }, { status: 401 });
		try {
			return NextResponse.json(await runBookmarkWorker(createServiceRoleClient()));
		} catch {
			return NextResponse.json(
				{ error: "북마크 작업 저장·실행 실패. 작업 상태를 확인해주세요." },
				{ status: 500 }
			);
		}
	}
);

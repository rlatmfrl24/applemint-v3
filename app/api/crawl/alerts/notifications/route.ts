import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/utils/supabase/service-role";
import { hasMinimumInternalSecretLength, hasValidInternalSecret } from "../../internal-auth";

const DEFAULT_NOTIFICATION_LIMIT = 100;
const POSITIVE_INTEGER = /^[1-9]\d*$/u;
const SAFE_ERROR_CODE = /^[a-z0-9_-]{1,64}$/u;
const GITHUB_ISSUE_URL = /^https:\/\/github[.]com\/[^/]+\/[^/]+\/issues\/[1-9]\d*$/u;

type AlertNotificationAction =
	| { action: "list"; limit?: number }
	| {
			action: "complete";
			notificationId: string;
			githubIssueNumber: number;
			githubIssueUrl: string;
	  }
	| { action: "fail"; notificationId: string; errorCode: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAction(value: unknown): AlertNotificationAction | null {
	if (!isRecord(value)) return null;
	if (value.action === "list") {
		const limit = value.limit ?? DEFAULT_NOTIFICATION_LIMIT;
		return Number.isInteger(limit) && Number(limit) >= 1 && Number(limit) <= 100
			? { action: "list", limit: Number(limit) }
			: null;
	}
	if (value.action === "complete") {
		if (
			typeof value.notificationId !== "string" ||
			!POSITIVE_INTEGER.test(value.notificationId) ||
			!Number.isSafeInteger(value.githubIssueNumber) ||
			Number(value.githubIssueNumber) <= 0 ||
			typeof value.githubIssueUrl !== "string" ||
			!GITHUB_ISSUE_URL.test(value.githubIssueUrl)
		) {
			return null;
		}
		return {
			action: "complete",
			notificationId: value.notificationId,
			githubIssueNumber: Number(value.githubIssueNumber),
			githubIssueUrl: value.githubIssueUrl,
		};
	}
	if (value.action === "fail") {
		if (
			typeof value.notificationId !== "string" ||
			!POSITIVE_INTEGER.test(value.notificationId) ||
			typeof value.errorCode !== "string" ||
			!SAFE_ERROR_CODE.test(value.errorCode)
		) {
			return null;
		}
		return {
			action: "fail",
			notificationId: value.notificationId,
			errorCode: value.errorCode,
		};
	}
	return null;
}

export async function POST(request: NextRequest) {
	const expectedSecret = process.env.CRAWL_INTERNAL_SECRET;
	if (!hasMinimumInternalSecretLength(expectedSecret)) {
		return NextResponse.json(
			{ error: "크롤러 알림 인증 설정이 완료되지 않았습니다." },
			{ status: 503 }
		);
	}
	if (!hasValidInternalSecret(request.headers.get("x-applemint-internal-secret"), expectedSecret)) {
		return NextResponse.json({ error: "인증되지 않은 크롤러 알림 요청입니다." }, { status: 401 });
	}

	const action = parseAction(await request.json().catch(() => null));
	if (!action) {
		return NextResponse.json({ error: "올바르지 않은 크롤러 알림 요청입니다." }, { status: 400 });
	}

	let supabase: ReturnType<typeof createServiceRoleClient>;
	try {
		supabase = createServiceRoleClient();
	} catch {
		return NextResponse.json(
			{ error: "크롤러 알림 서버 설정이 완료되지 않았습니다." },
			{ status: 503 }
		);
	}

	const rpc =
		action.action === "list"
			? await supabase.rpc("get_pending_crawl_alert_notifications", { p_limit: action.limit })
			: action.action === "complete"
				? await supabase.rpc("complete_crawl_alert_notification", {
						p_notification_id: action.notificationId,
						p_github_issue_number: action.githubIssueNumber,
						p_github_issue_url: action.githubIssueUrl,
					})
				: await supabase.rpc("fail_crawl_alert_notification", {
						p_notification_id: action.notificationId,
						p_error_code: action.errorCode,
					});

	if (rpc.error) {
		console.error("[crawl-alerts] notification_rpc_failed", { action: action.action });
		return NextResponse.json({ error: "크롤러 알림 상태 처리에 실패했습니다." }, { status: 500 });
	}

	if (action.action === "list") {
		if (!Array.isArray(rpc.data)) {
			return NextResponse.json(
				{ error: "크롤러 알림 응답 형식이 올바르지 않습니다." },
				{ status: 500 }
			);
		}
		return NextResponse.json({ notifications: rpc.data });
	}
	return NextResponse.json({
		[action.action === "complete" ? "completed" : "failed"]: rpc.data === true,
	});
}

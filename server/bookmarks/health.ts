import { BookmarkFetchError, safeFetch } from "./safe-fetch";
export interface LinkResult {
	status: "healthy" | "dead" | "restricted" | "temporary" | "uncheckable";
	reason: string;
	finalUrl: string | null;
	httpStatus: number | null;
}
function classifyResponse(result: Awaited<ReturnType<typeof safeFetch>>): LinkResult {
	const status = result.status;
	const base = { finalUrl: result.finalUrl, httpStatus: status };
	if ([404, 410].includes(status)) return { ...base, status: "dead", reason: `HTTP ${status}` };
	if (
		[401, 403, 407, 429].includes(status) ||
		/\/(?:log-?in|sign-?in|auth)(?:\/|$)/iu.test(new URL(result.finalUrl).pathname)
	)
		return { ...base, status: "restricted", reason: "인증 요구 또는 접근 제한" };
	if (status >= 500 || status === 408)
		return { ...base, status: "temporary", reason: `HTTP ${status}: 일시 장애 가능` };
	if (status >= 200 && status < 300)
		return { ...base, status: "healthy", reason: `HTTP ${status}: 응답 확인 (내용 유효성 미확인)` };
	return { ...base, status: "uncheckable", reason: `HTTP ${status}: 검사 불가` };
}
const failures: Record<BookmarkFetchError["code"], Pick<LinkResult, "status" | "reason">> = {
	NXDOMAIN: { status: "dead", reason: "DNS에서 도메인 부재 확인" },
	TIMEOUT: { status: "temporary", reason: "10초 시간 초과" },
	UNSAFE_URL: { status: "uncheckable", reason: "내부망·지원하지 않는 주소 차단" },
	REDIRECT_LIMIT: { status: "uncheckable", reason: "리다이렉트 5회 초과" },
	NETWORK: { status: "temporary", reason: "네트워크 또는 TLS 오류" },
};
export async function checkBookmarkLink(url: string): Promise<LinkResult> {
	try {
		return classifyResponse(await safeFetch(url));
	} catch (error) {
		return {
			...failures[error instanceof BookmarkFetchError ? error.code : "NETWORK"],
			finalUrl: null,
			httpStatus: null,
		};
	}
}

import { createHash } from "node:crypto";
import {
	type BookmarkHealthEvidence,
	bookmarkHealthEvidenceSchema,
} from "@/contracts/bookmark-health.schema";
import { extractHealthContent, type HealthMediaReference } from "./health-content";
import { classifyHealthMedia, type HealthIO } from "./health-media";
import { BookmarkFetchError, HealthRequestDeferred, safeFetch } from "./safe-fetch";
export type HealthBaseline = {
	checkId: string;
	url: string;
	observedAt: string;
	title: string;
	textHash: string;
	textLength: number;
	mediaReachable: number;
};
export type HealthInput = {
	title?: string;
	bookmarkId: string;
	url: string;
	version: number;
	baseline: HealthBaseline | null;
	decisionSample: boolean;
};
export type HealthObservation = {
	input: HealthInput;
	reachability: LinkResult;
	evidence: BookmarkHealthEvidence;
	mediaRefs: HealthMediaReference[];
};
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
export async function inspectBookmarkPage(
	input: HealthInput,
	io: HealthIO
): Promise<HealthObservation> {
	const evidence = bookmarkHealthEvidenceSchema.parse({
		observedAt: new Date().toISOString(),
		baselineCheckId: input.baseline?.checkId ?? null,
	});
	let response: Awaited<ReturnType<typeof safeFetch>>;
	try {
		response = await safeFetch(input.url, {
			maxBytes: 524288,
			signal: io.signal,
			beforeRequest: io.beforeRequest,
		});
	} catch (error) {
		if (error instanceof HealthRequestDeferred) throw error;
		return {
			input,
			evidence,
			mediaRefs: [],
			reachability: {
				...failures[error instanceof BookmarkFetchError ? error.code : "NETWORK"],
				finalUrl: null,
				httpStatus: null,
			},
		};
	}
	const reachability = classifyResponse(response);
	if (reachability.status !== "healthy") return { input, evidence, mediaRefs: [], reachability };
	if (/^(?:image|video)\//iu.test(response.contentType)) {
		const url = new URL(input.url);
		const ref: HealthMediaReference = {
			kind: response.contentType.startsWith("image/") ? "image" : "video",
			url: input.url,
			sourceUrl: `${url.origin}${url.pathname}`,
			label: `${url.host}${url.pathname}`.slice(0, 160),
			urlHash: createHash("sha256").update(input.url).digest("hex"),
		};
		const result = classifyHealthMedia(ref, response);
		evidence.content.applicable = false;
		evidence.coverage = "complete";
		evidence.media = {
			...evidence.media,
			discovered: 1,
			checked: 1,
			reachable: result.state === "reachable" ? 1 : 0,
			unknown: result.state === "unknown" ? 1 : 0,
			missing: result.state === "missing" ? 1 : 0,
			restricted: result.state === "restricted" ? 1 : 0,
			items: [result],
			status: result.state === "reachable" ? "present" : "unknown",
		};
		return { input, reachability, evidence, mediaRefs: [] };
	}
	if (!/html/iu.test(response.contentType)) {
		evidence.content.status = "unknown";
		evidence.content.reasonCodes.push("CONTENT_TYPE_UNSUPPORTED");
		return { input, evidence, reachability, mediaRefs: [] };
	}
	const parsed = extractHealthContent({
		body: response.body,
		finalUrl: response.finalUrl,
		truncated: response.truncated,
	});
	parsed.evidence.baselineCheckId = input.baseline?.checkId ?? null;
	if (
		parsed.evidence.media.status === "none_detected" &&
		input.baseline &&
		input.baseline.mediaReachable > 0 &&
		parsed.evidence.content.status === "present"
	)
		parsed.evidence.media.status = "missing_suspected";
	return { input, reachability, ...parsed };
}

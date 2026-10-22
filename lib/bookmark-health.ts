import type { BookmarkItem } from "@/contracts/bookmark.schema";
export const contentHealthLabels = {
	present: "본문 확인",
	deleted_suspected: "본문 삭제 의심",
	changed_suspected: "내용 변경 의심",
	restricted: "접근 제한",
	unknown: "판단 불가",
	not_checked: "미검사",
};
export const mediaHealthLabels = {
	present: "응답 확인",
	partial: "일부 확인 실패",
	missing_suspected: "소실 의심",
	none_detected: "미디어 미검출",
	unknown: "판단 불가",
	not_checked: "미검사",
};
export const aiHealthLabels = {
	not_needed: "규칙 판정",
	not_configured: "AI 미설정",
	pending: "AI 예산 대기",
	completed: "AI 판정 완료",
	uncertain: "AI 비용 확인 필요",
	failed: "AI 출력 확인 필요",
};
function currentHealthCheck(item: BookmarkItem) {
	const c = item.check;
	return c &&
		c.bookmark_version === item.version &&
		(c.checked_url === null || c.checked_url === item.url)
		? c
		: null;
}
export function healthReviewInput(item: BookmarkItem) {
	const c = currentHealthCheck(item);
	return {
		id: item.id,
		version: item.version,
		...(c
			? { evidenceId: c.id, ...(c.evidence ? { evidenceRevision: c.evidence_revision } : {}) }
			: {}),
	};
}
export function healthSummary(
	item: BookmarkItem
): { label: string; detail: string; severity: "neutral" | "warning" | "danger" } | null {
	const c = currentHealthCheck(item);
	if (!c || c.reviewed_at) return null;
	if (!c.evidence) return legacySummary(c);
	const e = c.evidence;
	const detail = healthDetail(e);
	if (c.status === "dead") return { label: "죽은 링크 의심", detail, severity: "danger" };
	if (["deleted_suspected", "changed_suspected"].includes(e.content.status))
		return { label: contentHealthLabels[e.content.status], detail, severity: "warning" };
	if (["partial", "missing_suspected"].includes(e.media.status))
		return {
			label: e.media.status === "partial" ? "미디어 일부 확인 실패" : "미디어 소실 의심",
			detail,
			severity: "warning",
		};
	if (c.status !== "healthy" || e.content.status === "restricted")
		return { label: "접근 제한·판단 불가", detail, severity: "warning" };
	if (e.content.applicable && e.content.status !== "present")
		return { label: "내용 판단 불가", detail, severity: "warning" };
	if (e.coverage !== "complete" || ["unknown", "not_checked"].includes(e.media.status))
		return { label: "일부만 확인", detail, severity: "warning" };
	return {
		label: normalHealthLabel(e),
		detail,
		severity: "neutral",
	};
}

function legacySummary(
	c: NonNullable<BookmarkItem["check"]>
): NonNullable<ReturnType<typeof healthSummary>> {
	return {
		label:
			c.status === "healthy"
				? "접속 확인 · 내용 미검사"
				: c.status === "dead"
					? "죽은 링크 의심"
					: "접속 판단 불가",
		detail: `과거 접속 검사 · ${c.reason} · 본문·미디어 미검사`,
		severity: c.status === "dead" ? "danger" : "neutral",
	};
}
function healthDetail(e: NonNullable<NonNullable<BookmarkItem["check"]>["evidence"]>) {
	return [
		`미디어 ${e.media.checked}/${e.media.discovered}개 검사`,
		e.coverage === "complete" ? "추출 범위 확인" : "제한된 검사 범위",
		e.confirmation === "pending"
			? "재확인 예정"
			: e.confirmation === "repeated"
				? "재확인에서도 같은 의심"
				: "",
		aiHealthLabels[e.ai.state],
	]
		.filter(Boolean)
		.join(" · ");
}

function normalHealthLabel(e: NonNullable<NonNullable<BookmarkItem["check"]>["evidence"]>) {
	return e.content.applicable
		? e.media.status === "none_detected"
			? "본문 확인 · 미디어 미검출"
			: "본문·미디어 응답 확인"
		: "미디어 응답 확인";
}

import { expect, it } from "vitest";
import { bookmarkHealthEvidenceSchema } from "@/contracts/bookmark-health.schema";
import { bookmarkItem } from "@/test-support/bookmark-form-fixtures";
import { healthReviewInput, healthSummary } from "./bookmark-health";

function sample() {
	const item = bookmarkItem();
	item.check = {
		id: "11111111-1111-4111-8111-111111111111",
		bookmark_id: item.id,
		job_id: "22222222-2222-4222-8222-222222222222",
		bookmark_version: item.version,
		status: "healthy",
		reason: "HTTP 200",
		final_url: item.url,
		http_status: 200,
		checked_at: "2026-10-22T00:00:00Z",
		checked_url: item.url,
		evidence: bookmarkHealthEvidenceSchema.parse({ observedAt: "2026-10-22T00:00:00Z" }),
		evidence_revision: 3,
		reviewed_at: null,
	};
	return item;
}
it("HTTP success never labels content healthy", () => {
	expect(healthSummary(sample())?.label).toBe("내용 판단 불가");
});
it("limited media names its checked count", () => {
	const item = sample();
	if (!item.check?.evidence) throw Error();
	item.check.evidence.content.status = "present";
	item.check.evidence.coverage = "limited";
	item.check.evidence.media = {
		...item.check.evidence.media,
		status: "partial",
		discovered: 5,
		checked: 2,
		reachable: 1,
		missing: 1,
	};
	expect(healthSummary(item)).toMatchObject({
		label: "미디어 일부 확인 실패",
		detail: expect.stringContaining("2/5"),
	});
});
it("legacy evidence says connection only", () => {
	const item = sample();
	if (item.check) item.check.evidence = null;
	expect(healthSummary(item)?.label).toBe("접속 확인 · 내용 미검사");
});
it("stale or reviewed evidence cannot produce a candidate badge", () => {
	const item = sample();
	item.version++;
	expect(healthSummary(item)).toBeNull();
	item.version--;
	if (item.check) item.check.reviewed_at = "2026-10-22T01:00:00Z";
	expect(healthSummary(item)).toBeNull();
});
it("keep carries the displayed evidence revision", () => {
	const item = sample();
	expect(healthReviewInput(item)).toEqual({
		id: item.id,
		version: item.version,
		evidenceId: item.check?.id,
		evidenceRevision: 3,
	});
});

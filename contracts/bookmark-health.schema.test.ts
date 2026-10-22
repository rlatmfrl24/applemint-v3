import { expect, it } from "vitest";
import { bookmarkListInputSchema, bookmarkSnapshotSchema } from "./bookmark.schema";
import {
	bookmarkHealthEvidenceBytes,
	bookmarkHealthEvidenceSchema,
	bookmarkHealthSettingsInputSchema,
} from "./bookmark-health.schema";

it("legacy HTTP success has no content evidence", () => {
	const schema = bookmarkSnapshotSchema.shape.items.element.shape.check.unwrap();
	const check = schema.parse({
		id: "aaaaaaaa-0000-4000-8000-000000000001",
		bookmark_id: "aaaaaaaa-0000-4000-8000-000000000002",
		job_id: "aaaaaaaa-0000-4000-8000-000000000003",
		bookmark_version: 1,
		status: "healthy",
		reason: "HTTP 200",
		final_url: "https://example.com",
		http_status: 200,
		checked_at: "2026-10-22T00:00:00Z",
		reviewed_at: null,
	});
	expect(check.status).toBe("healthy");
	expect(check.evidence).toBeNull();
	expect(check.evidence_revision).toBe(1);
});

it("limited media never becomes fully healthy", () => {
	const evidence = bookmarkHealthEvidenceSchema.parse({ observedAt: "2026-10-22T00:00:00Z" });
	expect(evidence.content.status).toBe("not_checked");
	expect(evidence.media.status).toBe("not_checked");
	expect(
		bookmarkHealthEvidenceSchema.safeParse({
			...evidence,
			coverage: "limited",
			media: { ...evidence.media, status: "present" },
		}).success
	).toBe(false);
	expect(
		bookmarkHealthEvidenceSchema.safeParse({
			...evidence,
			media: { ...evidence.media, checked: 1 },
		}).success
	).toBe(false);
});

it("health settings enforce 1 through 1000", () => {
	for (const dailyLimit of [0, 1001, 1.5])
		expect(bookmarkHealthSettingsInputSchema.safeParse({ enabled: true, dailyLimit }).success).toBe(
			false
		);
	expect(bookmarkHealthSettingsInputSchema.parse({ enabled: true, dailyLimit: 500 })).toEqual({
		enabled: true,
		dailyLimit: 500,
	});
	for (const reviewType of ["content", "media", "uncheckable"])
		expect(bookmarkListInputSchema.parse({ review: true, reviewType }).reviewType).toBe(reviewType);
});

it("rejects oversized evidence and invalid confirmation timestamps", () => {
	expect(bookmarkHealthEvidenceSchema.safeParse({ observedAt: "invalid" }).success).toBe(false);
	expect(
		bookmarkHealthEvidenceSchema.safeParse({
			observedAt: "2026-10-22T00:00:00Z",
			reasonCodes: Array(100).fill("x".repeat(160)),
		}).success
	).toBe(false);
});
it("counts PostgreSQL separator whitespace without changing strings and reserves exponent expansion", () => {
	expect(bookmarkHealthEvidenceBytes({ label: '한글: a,b "quoted"', count: 2 })).toBe(
		new TextEncoder().encode('{"label": "한글: a,b \\"quoted\\"", "count": 2}').byteLength
	);
	expect(bookmarkHealthEvidenceBytes({ confidence: 1e-100 })).toBeGreaterThanOrEqual(120);
});

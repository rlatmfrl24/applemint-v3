import { z } from "zod";

const count = z.number().int().nonnegative();
const time = z.iso.datetime({ offset: true });
const reasons = z.array(z.string().max(160)).max(32).default([]);
export function bookmarkHealthEvidenceBytes(evidence: unknown) {
	const json = JSON.stringify(evidence);
	let overhead = 0;
	// PostgreSQL jsonb::text adds separator spaces and expands exponent notation.
	for (const [token] of json.matchAll(/"(?:[^"\\]|\\.)*"|[:,]|-?\d+(?:\.\d+)?[eE][+-]?\d+/gu)) {
		if (token === ":" || token === ",") overhead++;
		else if (!token.startsWith('"') && /e/iu.test(token)) {
			const [mantissa, exponent] = token.toLowerCase().split("e");
			overhead += Math.max(0, Math.abs(Number(exponent)) + mantissa.length + 3 - token.length);
		}
	}
	return new TextEncoder().encode(json).byteLength + overhead;
}
export const bookmarkHealthSettingsInputSchema = z.object({
	enabled: z.boolean(),
	dailyLimit: z.number().int().min(1).max(1000),
});
export const bookmarkHealthEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1).default(1),
		observedAt: time,
		content: z
			.object({
				applicable: z.boolean().default(true),
				status: z
					.enum([
						"present",
						"deleted_suspected",
						"changed_suspected",
						"restricted",
						"unknown",
						"not_checked",
					])
					.default("not_checked"),
				title: z.string().max(1000).default(""),
				textLength: count.default(0),
				textHash: z
					.string()
					.regex(/^[a-f0-9]{64}$/u)
					.nullable()
					.default(null),
				excerpt: z.string().max(500).default(""),
				reasonCodes: reasons,
			})
			.prefault({}),
		media: z
			.object({
				applicable: z.boolean().default(true),
				status: z
					.enum([
						"present",
						"partial",
						"missing_suspected",
						"none_detected",
						"unknown",
						"not_checked",
					])
					.default("not_checked"),
				discovered: count.default(0),
				checked: count.default(0),
				reachable: count.default(0),
				missing: count.default(0),
				restricted: count.default(0),
				unknown: count.default(0),
				excludedCount: count.default(0),
				duplicateCount: count.default(0),
				omittedCount: count.default(0),
				items: z
					.array(
						z.object({
							kind: z.enum(["image", "video", "embed"]),
							label: z.string().max(160),
							urlHash: z.string().regex(/^[a-f0-9]{64}$/u),
							state: z.enum(["reachable", "missing", "restricted", "unknown"]),
							httpStatus: z.number().int().nullable(),
							reasonCode: z.string().max(160),
						})
					)
					.max(20)
					.default([]),
			})
			.prefault({}),
		coverage: z.enum(["complete", "limited", "unknown"]).default("unknown"),
		confirmation: z.enum(["not_required", "pending", "repeated"]).default("not_required"),
		confirmationEvidence: z
			.object({
				firstObservedAt: time.nullable().default(null),
				firstFingerprint: z.string().nullable().default(null),
				confirmedAt: time.nullable().default(null),
			})
			.prefault({}),
		baselineCheckId: z.uuid().nullable().default(null),
		ai: z
			.object({
				state: z
					.enum(["not_needed", "not_configured", "pending", "completed", "uncertain", "failed"])
					.default("not_needed"),
				model: z.string().nullable().default(null),
				choice: z.string().nullable().default(null),
				confidence: z.number().min(0).max(1).nullable().default(null),
				reservationId: z.uuid().nullable().default(null),
			})
			.prefault({}),
		reasonCodes: reasons,
	})
	.superRefine((evidence, ctx) => {
		const media = evidence.media;
		if (
			media.checked !== media.reachable + media.missing + media.restricted + media.unknown ||
			media.discovered < media.checked
		)
			ctx.addIssue({ code: "custom", message: "Invalid media counts", path: ["media"] });
		if (
			media.status === "present" &&
			(evidence.coverage !== "complete" ||
				media.checked === 0 ||
				media.reachable !== media.discovered)
		)
			ctx.addIssue({
				code: "custom",
				message: "Media confirmation requires complete response coverage",
				path: ["media", "status"],
			});
		if (bookmarkHealthEvidenceBytes(evidence) > 8192)
			ctx.addIssue({ code: "custom", message: "Health evidence exceeds 8192 bytes" });
	});
export type BookmarkHealthEvidence = z.infer<typeof bookmarkHealthEvidenceSchema>;

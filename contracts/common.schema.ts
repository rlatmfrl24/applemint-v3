import { z } from "zod";

const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

export const isoTimestampSchema = z
	.string()
	.refine(
		(value) =>
			value.includes("T") &&
			Number.isFinite(Date.parse(value)) &&
			/^\d{4}-\d{2}-\d{2}T/u.test(value),
		"올바른 ISO 8601 시각이 필요합니다."
	);

export const decimalIdSchema = z
	.union([z.string(), z.number().int().positive().safe()])
	.transform((value, context) => {
		const normalized = typeof value === "number" ? String(value) : value.trim();
		if (!/^\d+$/u.test(normalized)) {
			context.addIssue({ code: "custom", message: "올바른 식별자가 필요합니다." });
			return z.NEVER;
		}

		const parsed = BigInt(normalized);
		if (parsed <= BigInt(0) || parsed > MAX_POSTGRES_BIGINT) {
			context.addIssue({ code: "custom", message: "식별자가 허용 범위를 벗어났습니다." });
			return z.NEVER;
		}

		return parsed.toString();
	});

export const publicDecimalIdSchema = z
	.string()
	.trim()
	.regex(/^\d+$/u, "올바른 식별자가 필요합니다.")
	.refine((value) => {
		const parsed = BigInt(value);
		return parsed > BigInt(0) && parsed <= MAX_POSTGRES_BIGINT;
	}, "식별자가 허용 범위를 벗어났습니다.")
	.transform((value) => BigInt(value).toString());

export const nonNegativeIntegerSchema = z.number().int().nonnegative().finite();

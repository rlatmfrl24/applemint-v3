import { describe, expect, it } from "vitest";
import { threadRow } from "@/test/support/communication";
import {
	threadItemSchema,
	threadListInputSchema,
	threadTransitionInputSchema,
} from "./thread.schema";

describe("thread Zod contract", () => {
	it("Supabase bigint ID를 손실 없는 decimal string으로 정규화한다", () => {
		expect(threadItemSchema.parse(threadRow).id).toBe("3");
		expect(threadItemSchema.parse({ ...threadRow, id: "9007199254740993" }).id).toBe(
			"9007199254740993"
		);
	});

	it("PostgreSQL bigint 범위를 벗어난 ID를 거부한다", () => {
		expect(threadItemSchema.safeParse({ ...threadRow, id: "9223372036854775808" }).success).toBe(
			false
		);
		expect(threadItemSchema.safeParse({ ...threadRow, id: "not-an-id" }).success).toBe(false);
	});

	it("YouTube가 아닌 legacy metadata는 일반 카드용 null로 정규화한다", () => {
		const parsed = threadItemSchema.parse({
			...threadRow,
			type: "normal",
			url: "https://example.com/legacy-media",
			media_metadata: {
				...threadRow.media_metadata,
				provider: "legacy-provider",
			},
		});

		expect(parsed.media_metadata).toBeNull();
	});

	it("목록 기본값을 한 곳에서 적용하고 알 수 없는 입력 필드를 거부한다", () => {
		expect(threadListInputSchema.parse({ state: "inbox" })).toEqual({
			state: "inbox",
			limit: 24,
		});
		expect(threadListInputSchema.safeParse({ state: "inbox", unexpected: true }).success).toBe(
			false
		);
	});

	it("상태 전이 입력은 정식 상태와 decimal string ID만 허용한다", () => {
		expect(
			threadTransitionInputSchema.parse({
				id: "00012",
				expectedState: "inbox",
				destinationState: "saved",
			}).id
		).toBe("12");
		expect(
			threadTransitionInputSchema.safeParse({
				id: 12,
				expectedState: "inbox",
				destinationState: "saved",
			}).success
		).toBe(false);
		expect(
			threadTransitionInputSchema.safeParse({
				id: "12",
				expectedState: "inbox",
				destinationState: "unknown",
			}).success
		).toBe(false);
	});
});

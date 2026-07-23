import { describe, expect, it } from "vitest";
import { flattenThreadPages } from "./thread-list-contract";

describe("thread list contract", () => {
	it("JavaScript 안전 범위를 넘는 bigint id도 손실 없이 중복 제거한다", () => {
		const item = {
			id: "9007199254740993",
			type: "normal",
			url: "https://example.com/bigint",
			title: "bigint",
			description: null,
			host: "example.com",
			state: "inbox" as const,
			created_at: "2026-07-20T00:00:00.000Z",
			captured_at: "2026-07-20T00:00:00.000Z",
			state_changed_at: "2026-07-20T00:00:00.000Z",
		};

		expect(
			flattenThreadPages([
				{ items: [item], nextCursor: "next" },
				{ items: [{ ...item, id: "+9007199254740993" }], nextCursor: null },
			])
		).toEqual([item]);
	});

	it("여러 페이지를 순서대로 합치면서 중복 id를 제거한다", () => {
		const first = {
			id: 2,
			type: "normal",
			url: "https://example.com/2",
			title: "two",
			description: null,
			host: "example.com",
			state: "inbox" as const,
			created_at: "2026-07-20T00:00:00.000Z",
			captured_at: "2026-07-20T00:00:00.000Z",
			state_changed_at: "2026-07-20T00:00:00.000Z",
		};
		const second = { ...first, id: "1", url: "https://example.com/1" };

		expect(
			flattenThreadPages([
				{ items: [first, second], nextCursor: "next" },
				{ items: [{ ...second, id: 1 }], nextCursor: null },
			])
		).toEqual([first, second]);
	});
});

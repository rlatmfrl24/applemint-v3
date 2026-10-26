import { expect, it } from "vitest";
import { bookmarkListInputSchema } from "./bookmark.schema";

it("preserves the optional review group without changing legacy requests", () => {
	for (const reviewGroup of ["problems", "attention", "organize", "classify"]) {
		expect(bookmarkListInputSchema.parse({ review: true, reviewGroup }).reviewGroup).toBe(
			reviewGroup
		);
	}
	expect(bookmarkListInputSchema.parse({ review: true }).reviewGroup).toBeUndefined();
	expect(bookmarkListInputSchema.safeParse({ reviewGroup: "invalid" }).success).toBe(false);
});

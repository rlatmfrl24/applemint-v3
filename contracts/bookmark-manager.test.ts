import { expect, it } from "vitest";
import { bookmarkListInputSchema } from "./bookmark.schema";

it("preserves review type so server pagination is scoped to the selected result kind", () => {
	expect(
		bookmarkListInputSchema.parse({ review: true, reviewType: "dead", limit: 100 })
	).toMatchObject({
		reviewType: "dead",
		limit: 100,
	});
	expect(bookmarkListInputSchema.safeParse({ reviewType: "unknown" }).success).toBe(false);
});

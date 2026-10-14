import { expect, it, vi } from "vitest";
import type { BookmarkRepository } from "@/server/repositories/bookmark.repository";
import { BookmarkService } from "./bookmark.service";

it("rejects an old popup URL instead of silently saving a changed source URL", async () => {
	const store = {
		sourceThread: vi
			.fn()
			.mockResolvedValue({ url: "https://example.com/changed", title: "Changed" }),
		command: vi.fn(),
	};
	const service = new BookmarkService(store as unknown as BookmarkRepository);
	await expect(
		service.save({
			url: "https://example.com/original",
			threadId: "1",
			title: "Original",
			tags: [],
			note: "",
		})
	).rejects.toMatchObject({ code: "StateConflict" });
	expect(store.command).not.toHaveBeenCalled();
});

it("compares normalized URLs and keeps the server source for atomic save validation", async () => {
	const store = {
		sourceThread: vi.fn().mockResolvedValue({ url: "https://example.com/", title: "Original" }),
		command: vi.fn().mockResolvedValue(null),
	};
	await new BookmarkService(store as unknown as BookmarkRepository).save({
		url: "https://EXAMPLE.com",
		threadId: "1",
		title: "Original",
		tags: [],
		note: "",
	});
	expect(store.command).toHaveBeenCalledWith(
		"save",
		expect.objectContaining({
			url: "https://example.com/",
			expectedSourceUrl: "https://example.com/",
		}),
		expect.anything()
	);
});

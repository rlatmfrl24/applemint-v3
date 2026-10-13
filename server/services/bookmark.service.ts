import { z } from "zod";
import {
	type BookmarkSaveInput,
	type BookmarkScope,
	bookmarkCollectionSchema,
	bookmarkJobSchema,
	bookmarkSchema,
} from "@/contracts/bookmark.schema";
import { normalizeBookmarkUrl } from "@/server/bookmarks/url";
import { getBookmarkConfiguration } from "@/server/env/bookmarks";
import type { BookmarkRepository } from "@/server/repositories/bookmark.repository";

export class BookmarkService {
	constructor(private readonly store: BookmarkRepository) {}
	snapshot(input: object) {
		return this.store.snapshot(input);
	}
	configuration() {
		return getBookmarkConfiguration();
	}
	async save(input: BookmarkSaveInput) {
		const source = input.threadId ? await this.store.sourceThread(input.threadId) : null;
		return this.store.command(
			"save",
			{
				...input,
				url: normalizeBookmarkUrl(source?.url ?? input.url),
				expectedSourceUrl: source?.url,
			},
			z.object({ item: bookmarkSchema, existing: z.boolean() })
		);
	}
	mutate(action: "edit" | "trash" | "restore" | "open" | "keep" | "move", input: object) {
		return this.store.command(action, input, bookmarkSchema);
	}
	collection(action: "collectionCreate" | "collectionRename", input: object) {
		return this.store.command(action, input, bookmarkCollectionSchema);
	}
	removeCollection(input: { id: string; version: number }) {
		return this.store.command(
			"collectionRemove",
			input,
			z.object({
				deletedId: z.uuid(),
				movedBookmarks: z.number().int().nonnegative(),
				reparentedCollections: z.number().int().nonnegative(),
			})
		);
	}
	start(
		kind: "import" | "check" | "classify" | "interests" | "review",
		scope: BookmarkScope,
		confirmed?: boolean
	) {
		return this.store.command("start", { ...scope, kind, confirmed }, bookmarkJobSchema);
	}
	resume(input: { id: string }) {
		return this.store.command("resume", input, bookmarkJobSchema);
	}
	jobDetails(input: { id: string; offset: number }) {
		return this.store.jobDetails(input.id, input.offset);
	}
	interests(input: { interests: string[] }) {
		return this.store.command(
			"interests",
			input,
			z.object({ interests: z.array(z.string()), interest_version: z.number().int() }).passthrough()
		);
	}
	apply(input: object) {
		return this.store.command("proposalApply", input, z.object({ applied: z.number().int() }));
	}
	bulk(input: object) {
		return this.store.command("bulk", input, z.object({ applied: z.number().int() }));
	}
}

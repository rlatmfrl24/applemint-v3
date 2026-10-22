import { z } from "zod";
import {
	type BookmarkSaveInput,
	type BookmarkScope,
	bookmarkCollectionSchema,
	bookmarkJobSchema,
	type bookmarkLookupInputSchema,
	type bookmarkRecommendationInputSchema,
	bookmarkSchema,
} from "@/contracts/bookmark.schema";
import { normalizeBookmarkUrl } from "@/server/bookmarks/url";
import { getBookmarkConfiguration } from "@/server/env/bookmarks";
import { DomainError } from "@/server/errors/domain-error";
import type { BookmarkRepository } from "@/server/repositories/bookmark.repository";

export class BookmarkService {
	constructor(private readonly store: BookmarkRepository) {}
	snapshot(input: object) {
		return this.store.snapshot(input);
	}
	configuration() {
		return getBookmarkConfiguration();
	}
	aiUsage() {
		return this.store.aiUsage();
	}
	private async source(input: z.infer<typeof bookmarkLookupInputSchema>) {
		const source = input.threadId ? await this.store.sourceThread(input.threadId) : null;
		if (source && normalizeBookmarkUrl(source.url) !== normalizeBookmarkUrl(input.url))
			throw new DomainError(
				"StateConflict",
				"원본 URL이 변경되었습니다. 수집 글 화면에서 저장 팝업을 다시 열어주세요."
			);
		return source;
	}
	async lookup(input: z.infer<typeof bookmarkLookupInputSchema>) {
		const source = await this.source(input);
		return this.store.lookup(normalizeBookmarkUrl(source?.url ?? input.url));
	}
	async save(input: BookmarkSaveInput) {
		const source = await this.source(input);
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
	collection(
		action: "collectionCreate" | "collectionRename" | "collectionMove" | "collectionReorder",
		input: object
	) {
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
	jobs() {
		return this.store.jobs();
	}
	recommend(input: z.infer<typeof bookmarkRecommendationInputSchema>) {
		if (!getBookmarkConfiguration().openrouter)
			throw new DomainError(
				"ConfigurationUnavailable",
				"저장 추천 설정이 필요합니다. 수동으로 저장할 수 있습니다."
			);
		return this.store.command("recommend", input, bookmarkJobSchema);
	}
	recommendation(input: { id: string }) {
		return this.store.recommendation(input.id);
	}
	interests(input: { interests: string[]; version?: number }) {
		return this.store.command(
			"interests",
			input,
			z.object({ interests: z.array(z.string()), interest_version: z.number().int() }).passthrough()
		);
	}
	apply(input: object) {
		return this.store.command("proposalApply", input, z.object({ applied: z.number().int() }));
	}
	excludeProposals(input: object) {
		return this.store.command("proposalExclude", input, z.object({ applied: z.number().int() }));
	}
	bulk(input: object) {
		return this.store.command("bulk", input, z.object({ applied: z.number().int() }));
	}
	moveMany(input: object) {
		return this.store.command("bulkMove", input, z.object({ applied: z.number().int() }));
	}
}

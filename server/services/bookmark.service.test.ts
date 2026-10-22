import { afterEach, describe, expect, it, vi } from "vitest";
import { BookmarkRepository } from "@/server/repositories/bookmark.repository";
import type { AppSupabaseClient } from "@/types/supabase";
import { BookmarkService } from "./bookmark.service";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const date = "2026-10-21T12:00:00.000Z";
const bookmark = {
	id,
	url: "https://example.com/",
	url_key: "https://example.com/",
	title: "Example",
	description: "",
	tags: [],
	note: "",
	collection_id: null,
	state: "library",
	version: 8,
	source_id: null,
	source_thread_id: null,
	original: null,
	saved_at: date,
	created_at: date,
	updated_at: date,
	opened_at: null,
	open_count: 0,
	review_revision: 1,
};
const collection = {
	id: otherId,
	parent_id: null,
	name: "Reading",
	version: 4,
	sort_order: 0,
	source_id: null,
	original: null,
	created_at: date,
};
const job = {
	id,
	kind: "check",
	state: "queued",
	scope: { scope: "all" },
	progress: {},
	total: 0,
	completed: 0,
	failed: 0,
	attempts: 0,
	available_at: date,
	lease_token: null,
	lease_expires_at: null,
	error: null,
	created_at: date,
	updated_at: date,
};

function createService(data: object) {
	const rpc = vi.fn().mockResolvedValue({ data, error: null });
	const service = new BookmarkService(
		new BookmarkRepository({ rpc } as unknown as AppSupabaseClient)
	);
	return { service, rpc };
}

afterEach(() => vi.unstubAllEnvs());

it("looks up the normalized source URL without issuing a mutation", async () => {
	const store = {
		sourceThread: vi.fn().mockResolvedValue({ url: "https://example.com/?q=1#s", title: "Source" }),
		lookup: vi.fn().mockResolvedValue(null),
		command: vi.fn(),
	};
	const service = new BookmarkService(store as unknown as BookmarkRepository);
	await expect(
		service.lookup({ url: " HTTPS://EXAMPLE.com:443/?q=1#s ", threadId: "1" })
	).resolves.toBeNull();
	expect(store.lookup).toHaveBeenCalledExactlyOnceWith("https://example.com/?q=1#s");
	expect(store.command).not.toHaveBeenCalled();
});
it("rejects a changed source or unsafe standalone URL before duplicate lookup", async () => {
	const store = {
		sourceThread: vi.fn().mockResolvedValue({ url: "https://example.com/changed" }),
		lookup: vi.fn(),
	};
	const service = new BookmarkService(store as unknown as BookmarkRepository);
	await expect(
		service.lookup({ url: "https://example.com/old", threadId: "1" })
	).rejects.toMatchObject({ code: "StateConflict" });
	await expect(service.lookup({ url: "https://user:password@example.com" })).rejects.toMatchObject({
		code: "InvalidInput",
	});
	expect(store.lookup).not.toHaveBeenCalled();
});

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

describe("BookmarkService RPC response contracts", () => {
	it("normalizes a standalone save and accepts only the bookmark save envelope", async () => {
		const { service, rpc } = createService({ item: bookmark, existing: false });
		const input = {
			url: "https://EXAMPLE.com:443/?utm_source=feed#section",
			title: "Example",
			tags: ["reading"],
			note: "Remember",
			collectionId: otherId,
			collectionVersion: 4,
			recommendationId: id,
		};

		await expect(service.save(input)).resolves.toMatchObject({
			item: { ...bookmark, previous_collection_path: null },
			existing: false,
		});
		expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
			p_action: "save",
			p_input: {
				...input,
				url: "https://example.com/?utm_source=feed#section",
				expectedSourceUrl: undefined,
			},
		});
		rpc.mockResolvedValueOnce({ data: { item: bookmark, existing: "false" }, error: null });
		await expect(service.save(input)).rejects.toMatchObject({ code: "UnexpectedFailure" });
	});

	it.each(["edit", "trash", "restore", "keep", "move", "open"] as const)(
		"preserves the caller's stale version and evidence for %s and validates the resulting bookmark",
		async (action) => {
			const { service, rpc } = createService(bookmark);
			const input = { id, version: 2, evidenceId: otherId };

			await expect(service.mutate(action, input)).resolves.toMatchObject({ id, version: 8 });
			expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
				p_action: action,
				p_input: input,
			});
			rpc.mockResolvedValueOnce({ data: { ...bookmark, state: "deleted" }, error: null });
			await expect(service.mutate(action, input)).rejects.toMatchObject({
				code: "UnexpectedFailure",
			});
		}
	);

	it.each(["collectionCreate", "collectionRename", "collectionMove", "collectionReorder"] as const)(
		"sends %s with hierarchy/version data and validates the collection result",
		async (action) => {
			const { service, rpc } = createService(collection);
			const input = {
				id: otherId,
				version: 3,
				parentId: id,
				targetId: id,
				targetVersion: 2,
				position: "before",
			};

			await expect(service.collection(action, input)).resolves.toEqual(collection);
			expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
				p_action: action,
				p_input: input,
			});
			rpc.mockResolvedValueOnce({ data: { ...collection, version: "4" }, error: null });
			await expect(service.collection(action, input)).rejects.toMatchObject({
				code: "UnexpectedFailure",
			});
		}
	);

	it("requires nonnegative collection removal counts and forwards the expected version", async () => {
		const result = { deletedId: id, movedBookmarks: 2, reparentedCollections: 1 };
		const { service, rpc } = createService(result);

		await expect(service.removeCollection({ id, version: 3 })).resolves.toEqual(result);
		expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
			p_action: "collectionRemove",
			p_input: { id, version: 3 },
		});
		rpc.mockResolvedValueOnce({ data: { ...result, movedBookmarks: -1 }, error: null });
		await expect(service.removeCollection({ id, version: 3 })).rejects.toMatchObject({
			code: "UnexpectedFailure",
		});
	});

	it.each([
		["import", { scope: "all" }, true],
		["check", { scope: "selected", ids: [id, otherId] }],
		["classify", { scope: "collection", collectionId: otherId }],
		["interests", { scope: "all" }],
		["review", { scope: "collection", collectionId: null }],
	] as const)(
		"starts %s with the requested scope and confirmation",
		async (kind, scope, confirmed = undefined) => {
			const { service, rpc } = createService({ ...job, kind });
			const input = scope.scope === "selected" ? { ...scope, ids: [...scope.ids] } : scope;

			await expect(service.start(kind, input, confirmed)).resolves.toMatchObject({
				kind,
				state: "queued",
			});
			expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
				p_action: "start",
				p_input: { ...scope, kind, confirmed },
			});
		}
	);

	it("resumes the requested job and rejects a malformed job response", async () => {
		const { service, rpc } = createService(job);
		await expect(service.resume({ id })).resolves.toEqual(job);
		expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
			p_action: "resume",
			p_input: { id },
		});
		rpc.mockResolvedValueOnce({ data: { ...job, state: "unknown" }, error: null });
		await expect(service.resume({ id })).rejects.toMatchObject({ code: "UnexpectedFailure" });
	});

	it("gates recommendations on usable configuration before making an RPC", async () => {
		vi.stubEnv("OPENROUTER_API_KEY", "  ");
		const { service, rpc } = createService({ ...job, kind: "recommend" });
		const input = { threadId: "9007199254740993", title: "Example", requestId: id };

		await expect(async () => service.recommend(input)).rejects.toMatchObject({
			code: "ConfigurationUnavailable",
		});
		expect(rpc).not.toHaveBeenCalled();
		vi.stubEnv("OPENROUTER_API_KEY", "configured");
		await expect(service.recommend(input)).resolves.toMatchObject({ kind: "recommend" });
		expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
			p_action: "recommend",
			p_input: input,
		});
	});

	it("returns configuration flags without exposing credentials", () => {
		vi.stubEnv("RAINDROP_IMPORT_TOKEN", "import-secret");
		vi.stubEnv("OPENROUTER_API_KEY", "ai-secret");
		vi.stubEnv("CRAWL_INTERNAL_SECRET", "  ");
		const { service } = createService({});
		expect(service.configuration()).toEqual({ raindrop: true, openrouter: true, worker: false });
	});

	it("retains interest metadata and forwards the optimistic settings version", async () => {
		const result = { interests: ["TypeScript"], interest_version: 5, suggested_interests: ["Web"] };
		const { service, rpc } = createService(result);
		const input = { interests: ["TypeScript"], version: 3 };

		await expect(service.interests(input)).resolves.toEqual(result);
		expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
			p_action: "interests",
			p_input: input,
		});
		rpc.mockResolvedValueOnce({ data: { ...result, interest_version: 1.5 }, error: null });
		await expect(service.interests(input)).rejects.toMatchObject({ code: "UnexpectedFailure" });
	});

	it.each([
		["apply", "proposalApply"],
		["excludeProposals", "proposalExclude"],
		["bulk", "bulk"],
		["moveMany", "bulkMove"],
	] as const)(
		"preserves batch input for %s and validates the applied count",
		async (method, action) => {
			const { service, rpc } = createService({ applied: 2 });
			const input = { items: [{ id, version: 2, evidenceId: otherId }], collectionId: null };

			await expect(service[method](input)).resolves.toEqual({ applied: 2 });
			expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
				p_action: action,
				p_input: input,
			});
			rpc.mockResolvedValueOnce({ data: { applied: "2" }, error: null });
			await expect(service[method](input)).rejects.toMatchObject({ code: "UnexpectedFailure" });
		}
	);

	it("forwards read filters, job pagination, and recommendation IDs to the repository", async () => {
		const store = {
			snapshot: vi.fn().mockResolvedValue({ total: 2 }),
			aiUsage: vi.fn().mockResolvedValue({ requestCount: 3 }),
			jobDetails: vi.fn().mockResolvedValue({ items: [], total: 51 }),
			jobs: vi.fn().mockResolvedValue([job]),
			recommendation: vi.fn().mockResolvedValue({ job, recommendation: null }),
		};
		const service = new BookmarkService(store as unknown as BookmarkRepository);
		const filter = { collectionId: otherId, offset: 50, search: "reading" };

		await expect(service.snapshot(filter)).resolves.toEqual({ total: 2 });
		await expect(service.aiUsage()).resolves.toEqual({ requestCount: 3 });
		await expect(service.jobDetails({ id, offset: 50 })).resolves.toEqual({ items: [], total: 51 });
		await expect(service.jobs()).resolves.toEqual([job]);
		await expect(service.recommendation({ id })).resolves.toEqual({ job, recommendation: null });
		expect(store.snapshot).toHaveBeenCalledExactlyOnceWith(filter);
		expect(store.aiUsage).toHaveBeenCalledExactlyOnceWith();
		expect(store.jobDetails).toHaveBeenCalledExactlyOnceWith(id, 50);
		expect(store.jobs).toHaveBeenCalledExactlyOnceWith();
		expect(store.recommendation).toHaveBeenCalledExactlyOnceWith(id);
	});
});
it("delegates health settings and the check-specific start envelope", async () => {
	const data = {
		enabled: false,
		dailyLimit: 500,
		timeZone: "Asia/Seoul",
		hour: 9,
		lastAutomaticJob: null,
		workerConfigured: false,
	};
	const { service, rpc } = createService(data);
	await expect(service.healthSettings()).resolves.toEqual(data);
	await expect(service.updateHealthSettings({ enabled: true, dailyLimit: 500 })).resolves.toEqual(
		data
	);
	rpc.mockResolvedValue({
		data: { job: null, requestedCount: 1, queuedCount: 0, reusedCount: 1, activeJobIds: [id] },
		error: null,
	});
	await expect(service.startHealth({ scope: "all" })).resolves.toMatchObject({
		job: null,
		queuedCount: 0,
	});
});

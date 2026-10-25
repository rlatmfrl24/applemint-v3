import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestMetrics } from "@/server/observability/request-metrics";
import { BookmarkRepository } from "@/server/repositories/bookmark.repository";
import { BookmarkService } from "@/server/services/bookmark.service";
import type { AppSupabaseClient } from "@/types/supabase";
import type { TRPCContext } from "../context";
import { appRouter, createCaller } from "../router";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const versioned = { id, version: 2, evidenceId: otherId };
const job = {
	id,
	kind: "recommend" as const,
	state: "queued" as const,
	scope: {},
	progress: {},
	total: 0,
	completed: 0,
	failed: 0,
	attempts: 0,
	available_at: "2026-10-21T12:00:00Z",
	lease_token: null,
	lease_expires_at: null,
	error: null,
	created_at: "2026-10-21T12:00:00Z",
	updated_at: "2026-10-21T12:00:00Z",
};
type Caller = ReturnType<typeof createCaller>;

function createContext(
	access: { kind: string; status?: number; message?: string } = { kind: "owner" }
) {
	const bookmark = {
		collections: vi.fn().mockResolvedValue([{ id: otherId, name: "Reading" }]),
		lookup: vi.fn().mockResolvedValue(null),
		snapshot: vi
			.fn()
			.mockResolvedValue({ items: [], collections: [{ id: otherId, name: "Reading" }] }),
		save: vi.fn().mockResolvedValue({ item: { id }, existing: false }),
		mutate: vi.fn().mockResolvedValue({ id, version: 3 }),
		bulk: vi.fn().mockResolvedValue({ applied: 1 }),
		collection: vi.fn().mockResolvedValue({ id: otherId, version: 3 }),
		moveMany: vi.fn().mockResolvedValue({ applied: 1 }),
		removeCollection: vi
			.fn()
			.mockResolvedValue({ deletedId: id, movedBookmarks: 1, reparentedCollections: 0 }),
		jobDetails: vi.fn().mockResolvedValue({ items: [], total: 0 }),
		configuration: vi.fn().mockReturnValue({ raindrop: true, openrouter: true, worker: false }),
		jobs: vi.fn().mockResolvedValue([job]),
		start: vi.fn().mockResolvedValue(job),
		startHealth: vi.fn().mockResolvedValue({
			job,
			requestedCount: 2,
			queuedCount: 2,
			reusedCount: 0,
			activeJobIds: [],
		}),
		resume: vi.fn().mockResolvedValue(job),
		aiUsage: vi.fn().mockResolvedValue({ requestCount: 2 }),
		recommend: vi.fn().mockResolvedValue(job),
		recommendation: vi.fn().mockResolvedValue({ job, recommendation: null }),
		interests: vi.fn().mockResolvedValue({ interests: ["Web"], interest_version: 3 }),
		excludeProposals: vi.fn().mockResolvedValue({ applied: 1 }),
		apply: vi.fn().mockResolvedValue({ applied: 1 }),
	};
	const getOwnerAccess = vi.fn().mockResolvedValue(access);
	const getAuthenticatedAccess = vi.fn();
	const context = {
		requestId: "bookmark-request",
		metrics: new RequestMetrics(),
		services: { bookmark },
		getOwnerAccess,
		getAuthenticatedAccess,
	} as unknown as TRPCContext;
	return {
		context,
		bookmark,
		getOwnerAccess,
		getAuthenticatedAccess,
		caller: createCaller(context),
	};
}

const protectedCalls: [string, (caller: Caller) => Promise<unknown>][] = [
	["bookmarkCheck.settings", (caller) => caller.bookmarkCheck.settings()],
	[
		"bookmarkCheck.updateSettings",
		(caller) => caller.bookmarkCheck.updateSettings({ enabled: true, dailyLimit: 500 }),
	],
	[
		"bookmark.lookup",
		(caller) => caller.bookmark.lookup({ url: "https://example.com/", threadId: "1" }),
	],
	["bookmark.list", (caller) => caller.bookmark.list({})],
	["bookmark.detail", (caller) => caller.bookmark.detail({ id })],
	["bookmark.save", (caller) => caller.bookmark.save({ url: "https://example.com" })],
	[
		"bookmark.edit",
		(caller) =>
			caller.bookmark.edit({
				...versioned,
				title: "Title",
				description: "",
				note: "",
				tags: [],
				collectionId: null,
			}),
	],
	["bookmark.open", (caller) => caller.bookmark.open({ id })],
	["bookmark.keep", (caller) => caller.bookmark.keep(versioned)],
	["bookmark.trash", (caller) => caller.bookmark.trash(versioned)],
	["bookmark.restore", (caller) => caller.bookmark.restore(versioned)],
	["bookmark.bulk", (caller) => caller.bookmark.bulk({ action: "trash", items: [versioned] })],
	[
		"bookmarkCollection.reorder",
		(caller) =>
			caller.bookmarkCollection.reorder({
				...versioned,
				targetId: otherId,
				targetVersion: 4,
				position: "after",
			}),
	],
	[
		"bookmarkCollection.moveMany",
		(caller) => caller.bookmarkCollection.moveMany({ items: [versioned], collectionId: null }),
	],
	[
		"bookmarkCollection.reparent",
		(caller) => caller.bookmarkCollection.reparent({ ...versioned, parentId: null }),
	],
	["bookmarkCollection.remove", (caller) => caller.bookmarkCollection.remove(versioned)],
	["bookmarkCollection.list", (caller) => caller.bookmarkCollection.list()],
	["bookmarkCollection.create", (caller) => caller.bookmarkCollection.create({ name: "Reading" })],
	[
		"bookmarkCollection.rename",
		(caller) => caller.bookmarkCollection.rename({ ...versioned, name: "Reading" }),
	],
	[
		"bookmarkCollection.move",
		(caller) => caller.bookmarkCollection.move({ ...versioned, collectionId: null }),
	],
	["bookmarkImport.details", (caller) => caller.bookmarkImport.details({ id })],
	["bookmarkImport.configuration", (caller) => caller.bookmarkImport.configuration()],
	["bookmarkImport.status", (caller) => caller.bookmarkImport.status()],
	["bookmarkImport.start", (caller) => caller.bookmarkImport.start({ confirmed: true })],
	["bookmarkImport.resume", (caller) => caller.bookmarkImport.resume({ id })],
	["bookmarkCheck.start", (caller) => caller.bookmarkCheck.start({ scope: "all" })],
	["bookmarkAI.usage", (caller) => caller.bookmarkAI.usage()],
	[
		"bookmarkAI.recommend",
		(caller) => caller.bookmarkAI.recommend({ threadId: "1", title: "Title", requestId: id }),
	],
	["bookmarkAI.recommendation", (caller) => caller.bookmarkAI.recommendation({ id })],
	["bookmarkAI.suggestInterests", (caller) => caller.bookmarkAI.suggestInterests()],
	[
		"bookmarkAI.confirmInterests",
		(caller) => caller.bookmarkAI.confirmInterests({ interests: [] }),
	],
	["bookmarkAI.classify", (caller) => caller.bookmarkAI.classify({ scope: "all" })],
	["bookmarkAI.review", (caller) => caller.bookmarkAI.review({ scope: "all" })],
	[
		"bookmarkProposal.excludeBookmarks",
		(caller) => caller.bookmarkProposal.excludeBookmarks({ items: [versioned] }),
	],
	["bookmarkProposal.approve", (caller) => caller.bookmarkProposal.approve({ items: [{ id }] })],
];

beforeEach(() => {
	vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("bookmark owner authorization", () => {
	it.each(protectedCalls)(
		"rejects %s before reaching a service when access is forbidden",
		async (_name, call) => {
			const { caller, bookmark, getOwnerAccess, getAuthenticatedAccess } = createContext({
				kind: "forbidden",
				status: 403,
				message: "Owner only",
			});

			await expect(call(caller)).rejects.toMatchObject({ code: "FORBIDDEN" });
			expect(getOwnerAccess).toHaveBeenCalledOnce();
			expect(getAuthenticatedAccess).not.toHaveBeenCalled();
			for (const method of Object.values(bookmark)) expect(method).not.toHaveBeenCalled();
		}
	);

	it.each([
		[{ kind: "unauthenticated", status: 401, message: "Sign in" }, "UNAUTHORIZED"],
		[{ kind: "unavailable", status: 503, message: "Try later" }, "SERVICE_UNAVAILABLE"],
	] as const)("maps %j access failures for bookmark reads", async (access, code) => {
		const { caller, bookmark } = createContext(access);
		await expect(caller.bookmark.list({})).rejects.toMatchObject({ code });
		expect(bookmark.snapshot).not.toHaveBeenCalled();
	});
});

describe("bookmark caller input contracts", () => {
	it("validates lookup input and forwards only URL and optional source", async () => {
		const { caller, bookmark } = createContext();
		await expect(
			caller.bookmark.lookup({ url: " https://example.com/ ", threadId: "123" })
		).resolves.toBeNull();
		expect(bookmark.lookup).toHaveBeenCalledExactlyOnceWith({
			url: "https://example.com/",
			threadId: "123",
		});
		await expect(caller.bookmark.lookup({ url: " " })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await expect(
			caller.bookmark.lookup({ url: "https://example.com/", threadId: "0" })
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
	it("applies listing defaults and reads collections independently of the snapshot", async () => {
		const { caller, bookmark, getOwnerAccess } = createContext();

		await expect(caller.bookmark.list({})).resolves.toMatchObject({ items: [] });
		expect(bookmark.snapshot).toHaveBeenNthCalledWith(1, {
			state: "library",
			offset: 0,
			review: false,
			reviewType: "all",
			limit: 50,
		});
		await caller.bookmark.detail({ id });
		expect(bookmark.snapshot).toHaveBeenNthCalledWith(2, { id });
		await expect(caller.bookmarkCollection.list()).resolves.toEqual([
			{ id: otherId, name: "Reading" },
		]);
		expect(bookmark.collections).toHaveBeenCalledOnce();
		expect(bookmark.snapshot).toHaveBeenCalledTimes(2);
		expect(getOwnerAccess).toHaveBeenCalledTimes(3);
	});

	it("normalizes save fields, applies defaults, and preserves collection/recommendation versions", async () => {
		const { caller, bookmark } = createContext();

		await expect(caller.bookmark.save({ url: " https://example.com/ " })).resolves.toEqual({
			item: { id },
			existing: false,
		});
		expect(bookmark.save).toHaveBeenNthCalledWith(1, {
			url: "https://example.com/",
			title: "",
			tags: [],
			note: "",
		});
		await caller.bookmark.save({
			url: "https://example.com/",
			title: " Title ",
			tags: [" Web "],
			threadId: "9007199254740993",
			collectionId: otherId,
			collectionVersion: 2,
			recommendationId: id,
		});
		expect(bookmark.save).toHaveBeenNthCalledWith(2, {
			url: "https://example.com/",
			title: "Title",
			tags: ["Web"],
			note: "",
			threadId: "9007199254740993",
			collectionId: otherId,
			collectionVersion: 2,
			recommendationId: id,
		});
	});

	it("preserves bookmark versions and evidence through edit, state changes, and batches", async () => {
		const { caller, bookmark } = createContext();
		const edit = {
			...versioned,
			title: " Title ",
			description: "Description",
			note: "Note",
			tags: [" Web "],
			collectionId: null,
		};

		await caller.bookmark.edit(edit);
		expect(bookmark.mutate).toHaveBeenCalledWith("edit", {
			...edit,
			title: "Title",
			tags: ["Web"],
		});
		await caller.bookmark.open({ id });
		expect(bookmark.mutate).toHaveBeenCalledWith("open", { id });
		for (const action of ["keep", "trash", "restore"] as const) {
			await caller.bookmark[action](versioned);
			expect(bookmark.mutate).toHaveBeenCalledWith(action, versioned);
		}
		await expect(caller.bookmark.bulk({ action: "keep", items: [versioned] })).resolves.toEqual({
			applied: 1,
		});
		expect(bookmark.bulk).toHaveBeenCalledExactlyOnceWith({ action: "keep", items: [versioned] });
	});

	it("preserves hierarchy targets and optimistic versions in collection changes", async () => {
		const { caller, bookmark } = createContext();

		await caller.bookmarkCollection.create({ name: " Reading ", parentId: null });
		expect(bookmark.collection).toHaveBeenCalledWith("collectionCreate", {
			name: "Reading",
			parentId: null,
		});
		await caller.bookmarkCollection.rename({ id, version: 2, name: " Renamed " });
		expect(bookmark.collection).toHaveBeenCalledWith("collectionRename", {
			id,
			version: 2,
			name: "Renamed",
		});
		await caller.bookmarkCollection.reparent({ ...versioned, parentId: otherId });
		expect(bookmark.collection).toHaveBeenCalledWith("collectionMove", {
			...versioned,
			parentId: otherId,
		});
		const reorder = {
			...versioned,
			targetId: otherId,
			targetVersion: 5,
			position: "before" as const,
		};
		await caller.bookmarkCollection.reorder(reorder);
		expect(bookmark.collection).toHaveBeenCalledWith("collectionReorder", reorder);
		await caller.bookmarkCollection.move({ ...versioned, collectionId: null });
		expect(bookmark.mutate).toHaveBeenCalledWith("move", { ...versioned, collectionId: null });
		await caller.bookmarkCollection.moveMany({ items: [versioned], collectionId: otherId });
		expect(bookmark.moveMany).toHaveBeenCalledExactlyOnceWith({
			items: [versioned],
			collectionId: otherId,
		});
		await caller.bookmarkCollection.remove(versioned);
		expect(bookmark.removeCollection).toHaveBeenCalledExactlyOnceWith(versioned);
	});

	it("requires explicit import confirmation and supplies default job item pagination", async () => {
		const { caller, bookmark } = createContext();

		await expect(caller.bookmarkImport.configuration()).resolves.toEqual({
			raindrop: true,
			openrouter: true,
			worker: false,
		});
		await expect(caller.bookmarkImport.status()).resolves.toEqual([job]);
		await caller.bookmarkImport.details({ id });
		expect(bookmark.jobDetails).toHaveBeenCalledExactlyOnceWith({ id, offset: 0 });
		await caller.bookmarkImport.start({ confirmed: true });
		expect(bookmark.start).toHaveBeenCalledExactlyOnceWith("import", { scope: "all" }, true);
		await caller.bookmarkImport.resume({ id });
		expect(bookmark.resume).toHaveBeenCalledExactlyOnceWith({ id });
	});

	it("forwards selected, collection, and global AI scopes and optimistic interest versions", async () => {
		const { caller, bookmark } = createContext();

		await caller.bookmarkCheck.start({ scope: "selected", ids: [id, otherId] });
		expect(bookmark.startHealth).toHaveBeenCalledWith({ scope: "selected", ids: [id, otherId] });
		await caller.bookmarkAI.classify({ scope: "collection", collectionId: null });
		expect(bookmark.start).toHaveBeenCalledWith("classify", {
			scope: "collection",
			collectionId: null,
		});
		await caller.bookmarkAI.review({ scope: "all" });
		expect(bookmark.start).toHaveBeenCalledWith("review", { scope: "all" });
		await caller.bookmarkAI.suggestInterests();
		expect(bookmark.start).toHaveBeenCalledWith("interests", { scope: "all" });
		await expect(
			caller.bookmarkAI.confirmInterests({ interests: [" Web "], version: 2 })
		).resolves.toEqual({ interests: ["Web"], interest_version: 3 });
		expect(bookmark.interests).toHaveBeenCalledExactlyOnceWith({ interests: ["Web"], version: 2 });
		await expect(caller.bookmarkAI.usage()).resolves.toEqual({ requestCount: 2 });
		await caller.bookmarkAI.recommend({
			threadId: "9007199254740993",
			title: " Title ",
			requestId: id,
		});
		expect(bookmark.recommend).toHaveBeenCalledExactlyOnceWith({
			threadId: "9007199254740993",
			title: "Title",
			requestId: id,
		});
		await expect(caller.bookmarkAI.recommendation({ id })).resolves.toEqual({
			job,
			recommendation: null,
		});
		expect(bookmark.recommendation).toHaveBeenCalledExactlyOnceWith({ id });
	});

	it("preserves proposal exclusion evidence and trims manually chosen collection names", async () => {
		const { caller, bookmark } = createContext();

		await caller.bookmarkProposal.excludeBookmarks({ items: [versioned] });
		expect(bookmark.excludeProposals).toHaveBeenCalledExactlyOnceWith({ items: [versioned] });
		await caller.bookmarkProposal.approve({
			items: [{ id, exclude: false, collectionId: null, newCollectionName: " Reading " }],
		});
		expect(bookmark.apply).toHaveBeenCalledExactlyOnceWith({
			items: [{ id, exclude: false, collectionId: null, newCollectionName: "Reading" }],
		});
	});

	const invalidCalls: [string, (caller: Caller) => Promise<unknown>][] = [
		["invalid ID", (caller) => caller.bookmark.detail({ id: "bad" })],
		["negative list offset", (caller) => caller.bookmark.list({ offset: -1 })],
		["oversized list limit", (caller) => caller.bookmark.list({ limit: 101 })],
		["oversized search", (caller) => caller.bookmark.list({ search: "x".repeat(201) })],
		["empty URL", (caller) => caller.bookmark.save({ url: " " })],
		[
			"noncanonical source thread ID",
			(caller) => caller.bookmark.save({ url: "https://example.com", threadId: "01" }),
		],
		["empty tag", (caller) => caller.bookmark.save({ url: "https://example.com", tags: [" "] })],
		["zero bookmark version", (caller) => caller.bookmark.trash({ id, version: 0 })],
		["empty bulk selection", (caller) => caller.bookmark.bulk({ action: "trash", items: [] })],
		[
			"oversized bulk selection",
			(caller) =>
				caller.bookmark.bulk({
					action: "trash",
					items: Array.from({ length: 2001 }, () => versioned),
				}),
		],
		["blank collection name", (caller) => caller.bookmarkCollection.create({ name: " " })],
		[
			"oversized collection name",
			(caller) => caller.bookmarkCollection.rename({ id, version: 1, name: "x".repeat(161) }),
		],
		[
			"noninteger reorder target version",
			(caller) =>
				caller.bookmarkCollection.reorder({
					...versioned,
					targetId: otherId,
					targetVersion: 1.5,
					position: "before",
				}),
		],
		[
			"empty move selection",
			(caller) => caller.bookmarkCollection.moveMany({ items: [], collectionId: null }),
		],
		["negative job offset", (caller) => caller.bookmarkImport.details({ id, offset: -1 })],
		[
			"missing import confirmation",
			(caller) => caller.bookmarkImport.start({} as { confirmed: true }),
		],
		[
			"empty scoped selection",
			(caller) => caller.bookmarkCheck.start({ scope: "selected", ids: [] }),
		],
		[
			"invalid collection scope",
			(caller) => caller.bookmarkAI.classify({ scope: "collection", collectionId: "bad" }),
		],
		[
			"invalid recommendation request ID",
			(caller) => caller.bookmarkAI.recommend({ threadId: "1", title: "Title", requestId: "bad" }),
		],
		["blank interest", (caller) => caller.bookmarkAI.confirmInterests({ interests: [" "] })],
		[
			"too many interests",
			(caller) =>
				caller.bookmarkAI.confirmInterests({ interests: Array.from({ length: 51 }, () => "Web") }),
		],
		["empty proposal approval", (caller) => caller.bookmarkProposal.approve({ items: [] })],
		[
			"empty proposal exclusion",
			(caller) => caller.bookmarkProposal.excludeBookmarks({ items: [] }),
		],
	];
	it.each(invalidCalls)("rejects %s before invoking a service", async (_name, call) => {
		const { caller, bookmark } = createContext();
		await expect(call(caller)).rejects.toMatchObject({ code: "BAD_REQUEST" });
		for (const method of Object.values(bookmark)) expect(method).not.toHaveBeenCalled();
	});

	it("rejects recommendation output that violates the public confidence contract", async () => {
		const { caller, bookmark } = createContext();
		bookmark.recommendation.mockResolvedValueOnce({
			job,
			recommendation: {
				collectionId: null,
				collectionVersion: null,
				basis: "uncertain",
				confidence: 2,
			},
		});
		await expect(caller.bookmarkAI.recommendation({ id })).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
		});
	});
});

describe("bookmark RPC errors through the HTTP boundary", () => {
	it.each([
		["40001", 409, "CONFLICT"],
		["42501", 403, "FORBIDDEN"],
		["P0002", 404, "NOT_FOUND"],
		["22023", 400, "BAD_REQUEST"],
		["XX000", 500, "INTERNAL_SERVER_ERROR"],
	] as const)(
		"maps database %s to HTTP %s and preserves the submitted stale version",
		async (databaseCode, status, code) => {
			const { context } = createContext();
			const rpc = vi.fn().mockResolvedValue({
				data: null,
				error: {
					code: databaseCode,
					message: "private database credential",
					details: "private details",
					hint: "",
				},
			});
			context.services.bookmark = new BookmarkService(
				new BookmarkRepository({ rpc } as unknown as AppSupabaseClient)
			);
			const response = await fetchRequestHandler({
				endpoint: "/api/trpc",
				req: new Request("http://localhost/api/trpc/bookmark.trash", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(versioned),
				}),
				router: appRouter,
				createContext: () => context,
			});
			const body = await response.json();

			expect(response.status).toBe(status);
			expect(body.error.data).toMatchObject({ code, requestId: "bookmark-request" });
			expect(body.error.message).not.toContain("private database");
			expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
				p_action: "trash",
				p_input: versioned,
			});
		}
	);

	it("returns a safe internal error for an invalid RPC response", async () => {
		const { context } = createContext();
		const rpc = vi
			.fn()
			.mockResolvedValue({ data: { id, state: "private database credential" }, error: null });
		context.services.bookmark = new BookmarkService(
			new BookmarkRepository({ rpc } as unknown as AppSupabaseClient)
		);

		const error = await createCaller(context)
			.bookmark.trash(versioned)
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			cause: { code: "UnexpectedFailure" },
		});
		expect((error as Error).message).not.toContain("private database credential");
	});
});
it("health settings require the owner and validate daily bounds", async () => {
	const { caller, bookmark } = createContext();
	Object.assign(bookmark, {
		healthSettings: vi.fn().mockResolvedValue({ enabled: false, dailyLimit: 500 }),
		updateHealthSettings: vi.fn().mockResolvedValue({ enabled: true, dailyLimit: 500 }),
	});
	await expect(caller.bookmarkCheck.settings()).resolves.toEqual({
		enabled: false,
		dailyLimit: 500,
	});
	for (const dailyLimit of [0, 1001])
		await expect(
			caller.bookmarkCheck.updateSettings({ enabled: true, dailyLimit })
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	const denied = createContext({ kind: "forbidden", status: 403, message: "Denied" });
	await expect(denied.caller.bookmarkCheck.settings()).rejects.toMatchObject({ code: "FORBIDDEN" });
});

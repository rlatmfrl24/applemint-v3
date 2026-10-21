import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RequestMetrics } from "@/server/observability/request-metrics";
import type { AppSupabaseClient } from "@/types/supabase";
import { BookmarkRepository } from "./bookmark.repository";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const date = "2026-10-21T12:00:00.000Z";
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
const snapshot = {
	items: [],
	total: 0,
	collections: [],
	jobs: [job],
	settings: {
		id: true,
		interests: [],
		interest_version: 1,
		suggested_interests: [],
		suggestions_job_id: null,
		suggested_at: null,
		interests_confirmed_at: null,
	},
	budget: { month: "2026-10", limit_nano: 100, used_nano: 0 },
};

function query(result: object) {
	const builder = Object.assign(Promise.resolve(result), {
		select: vi.fn().mockReturnThis(),
		filter: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		neq: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue(result),
		range: vi.fn().mockResolvedValue(result),
		maybeSingle: vi.fn().mockResolvedValue(result),
	});
	return builder;
}

function repositoryWithQuery(result: object) {
	const builder = query(result);
	const from = vi.fn().mockReturnValue(builder);
	return {
		builder,
		from,
		repository: new BookmarkRepository({ from } as unknown as AppSupabaseClient),
	};
}

describe("BookmarkRepository RPC contracts", () => {
	it("passes snapshot filters unchanged, validates the response, and records one measured call", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
		const metrics = new RequestMetrics();
		const repository = new BookmarkRepository({ rpc } as unknown as AppSupabaseClient, metrics);
		const input = { state: "trash", collectionId: null, offset: 50, limit: 25, review: true };

		await expect(repository.snapshot(input)).resolves.toEqual(snapshot);
		expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_snapshot", { p_filter: input });
		expect(metrics.snapshot()).toMatchObject({
			repositoryCallCount: 1,
			downstreamCallCount: 1,
			repositoryCalls: [{ operation: "bookmark.snapshot", callCount: 1 }],
		});
	});

	it("rejects a malformed snapshot as a safe domain failure", async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: { ...snapshot, jobs: [{ ...job, state: "unknown" }] },
			error: null,
		});
		const repository = new BookmarkRepository({ rpc } as unknown as AppSupabaseClient);

		await expect(repository.snapshot({})).rejects.toMatchObject({ code: "UnexpectedFailure" });
	});

	it.each([
		["22023", "InvalidInput"],
		["P0002", "NotFound"],
		["40001", "StateConflict"],
		["PT409", "StateConflict"],
		["42501", "Forbidden"],
		["XX000", "UnexpectedFailure"],
	] as const)("maps database code %s without exposing database details", async (code, expected) => {
		const rpc = vi.fn().mockResolvedValue({
			data: null,
			error: { code, message: "private database detail", details: "secret", hint: "secret" },
		});
		const repository = new BookmarkRepository({ rpc } as unknown as AppSupabaseClient);
		const error = await repository.snapshot({}).catch((caught: unknown) => caught);

		expect(error).toMatchObject({ code: expected });
		expect((error as Error).message).not.toContain("private database detail");
	});

	it("keeps optimistic versions and evidence in commands and parses the declared result", async () => {
		const rpc = vi
			.fn()
			.mockResolvedValue({ data: { applied: 1, privateField: "hidden" }, error: null });
		const metrics = new RequestMetrics();
		const repository = new BookmarkRepository({ rpc } as unknown as AppSupabaseClient, metrics);
		const input = { items: [{ id, version: 3, evidenceId: otherId }], action: "trash" };

		await expect(
			repository.command("bulk", input, z.object({ applied: z.number().int() }))
		).resolves.toEqual({ applied: 1 });
		expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
			p_action: "bulk",
			p_input: input,
		});
		expect(metrics.snapshot().repositoryCalls).toMatchObject([
			{ operation: "bookmark.command", callCount: 1 },
		]);
	});

	it("records failed commands and rejects responses that violate the supplied result contract", async () => {
		const rpc = vi.fn().mockResolvedValue({ data: { applied: "1" }, error: null });
		const metrics = new RequestMetrics();
		const repository = new BookmarkRepository({ rpc } as unknown as AppSupabaseClient, metrics);

		await expect(
			repository.command("bulk", {}, z.object({ applied: z.number().int() }))
		).rejects.toMatchObject({ code: "UnexpectedFailure" });
		expect(metrics.snapshot().repositoryCalls).toMatchObject([
			{ operation: "bookmark.command", callCount: 1 },
		]);
	});

	it("maps command conflicts without retrying or changing stale versions", async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: null,
			error: { code: "40001", message: "stale version", details: "", hint: "" },
		});
		const repository = new BookmarkRepository({ rpc } as unknown as AppSupabaseClient);

		await expect(
			repository.command("trash", { id, version: 1 }, z.unknown())
		).rejects.toMatchObject({
			code: "StateConflict",
		});
		expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_command", {
			p_action: "trash",
			p_input: { id, version: 1 },
		});
	});

	it("validates AI usage totals and preserves model attribution", async () => {
		const usage = {
			month: "2026-10",
			limitNano: 100,
			usedNano: 40,
			chargedNano: 30,
			heldNano: 10,
			requestCount: 2,
			models: [
				{
					provider: "provider",
					model: "model",
					requests: 2,
					settledRequests: 1,
					heldRequests: 1,
					chargedNano: 30,
					heldNano: 10,
				},
			],
		};
		const rpc = vi.fn().mockResolvedValue({ data: usage, error: null });
		const repository = new BookmarkRepository({ rpc } as unknown as AppSupabaseClient);

		await expect(repository.aiUsage()).resolves.toEqual(usage);
		expect(rpc).toHaveBeenCalledExactlyOnceWith("bookmark_ai_usage");
		rpc.mockResolvedValueOnce({ data: { ...usage, usedNano: -1 }, error: null });
		await expect(repository.aiUsage()).rejects.toThrow();
		rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
		await expect(repository.aiUsage()).rejects.toMatchObject({ code: "Forbidden" });
	});
});

describe("BookmarkRepository table queries", () => {
	it("reads only the requested source thread and distinguishes missing rows from database errors", async () => {
		const source = { url: "https://example.com/article", title: "Article" };
		const { repository, from, builder } = repositoryWithQuery({ data: source, error: null });

		await expect(repository.sourceThread("9007199254740993")).resolves.toEqual(source);
		expect(from).toHaveBeenCalledWith("threads");
		expect(builder.select).toHaveBeenCalledWith("url,title");
		expect(builder.filter).toHaveBeenCalledWith("id", "eq", "9007199254740993");
		builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
		await expect(repository.sourceThread("2")).rejects.toMatchObject({ code: "NotFound" });
		builder.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
		await expect(repository.sourceThread("2")).rejects.toMatchObject({ code: "Forbidden" });
	});

	it("pages unfinished job items with a stable order and preserves the exact count", async () => {
		const item = {
			bookmark_id: id,
			state: "waiting",
			error: null,
			available_at: date,
			bookmarks: { url: "https://example.com/", title: "Example" },
		};
		const { repository, from, builder } = repositoryWithQuery({
			data: [item],
			count: 51,
			error: null,
		});

		await expect(repository.jobDetails(otherId, 50)).resolves.toEqual({ items: [item], total: 51 });
		expect(from).toHaveBeenCalledWith("bookmark_job_items");
		expect(builder.select).toHaveBeenCalledWith(
			"bookmark_id,state,error,available_at,bookmarks(url,title)",
			{ count: "exact" }
		);
		expect(builder.eq).toHaveBeenCalledWith("job_id", otherId);
		expect(builder.neq).toHaveBeenCalledWith("state", "done");
		expect(builder.order.mock.calls).toEqual([["state"], ["bookmark_id"]]);
		expect(builder.range).toHaveBeenCalledWith(50, 99);
		builder.range.mockResolvedValueOnce({ data: null, count: null, error: null });
		await expect(repository.jobDetails(otherId, 100)).resolves.toEqual({ items: [], total: 0 });
		builder.range.mockResolvedValueOnce({ data: [{ ...item, state: "done" }], error: null });
		await expect(repository.jobDetails(otherId, 0)).rejects.toThrow();
		builder.range.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
		await expect(repository.jobDetails(otherId, 0)).rejects.toMatchObject({ code: "Forbidden" });
	});

	it("merges recent jobs with older imports, deduplicates by ID, and sorts newest first", async () => {
		const recent = query({ data: [job], error: null });
		const importJob = { ...job, id: otherId, kind: "import", created_at: "2026-01-01T00:00:00Z" };
		const imports = query({ data: [job, importJob], error: null });
		const from = vi.fn().mockReturnValueOnce(recent).mockReturnValueOnce(imports);
		const repository = new BookmarkRepository({ from } as unknown as AppSupabaseClient);

		await expect(repository.jobs()).resolves.toEqual([job, importJob]);
		expect(from.mock.calls).toEqual([["bookmark_jobs"], ["bookmark_jobs"]]);
		expect(recent.order).toHaveBeenCalledWith("created_at", { ascending: false });
		expect(recent.limit).toHaveBeenCalledWith(30);
		expect(imports.eq).toHaveBeenCalledWith("kind", "import");
	});

	it.each([0, 1])("rejects the merged job list if query %s fails", async (failedIndex) => {
		const results = [0, 1].map((index) =>
			query({ data: [], error: index === failedIndex ? { code: "42501" } : null })
		);
		const from = vi.fn().mockReturnValueOnce(results[0]).mockReturnValueOnce(results[1]);
		const repository = new BookmarkRepository({ from } as unknown as AppSupabaseClient);

		await expect(repository.jobs()).rejects.toMatchObject({ code: "Forbidden" });
	});

	it("treats absent job result sets as empty", async () => {
		const { repository } = repositoryWithQuery({ data: null, error: null });
		await expect(repository.jobs()).resolves.toEqual([]);
	});

	it("filters recommendation lookups by job kind and validates nullable recommendation progress", async () => {
		const recommendation = {
			collectionId: otherId,
			collectionVersion: 4,
			basis: "topic",
			confidence: 0.8,
		};
		const recommendationJob = { ...job, kind: "recommend", progress: { recommendation } };
		const { repository, builder } = repositoryWithQuery({ data: recommendationJob, error: null });

		await expect(repository.recommendation(id)).resolves.toEqual({
			job: recommendationJob,
			recommendation,
		});
		expect(builder.eq.mock.calls).toEqual([
			["id", id],
			["kind", "recommend"],
		]);
		builder.maybeSingle.mockResolvedValueOnce({
			data: { ...recommendationJob, progress: {} },
			error: null,
		});
		await expect(repository.recommendation(id)).resolves.toMatchObject({ recommendation: null });
		builder.maybeSingle.mockResolvedValueOnce({
			data: {
				...recommendationJob,
				progress: { recommendation: { ...recommendation, confidence: 2 } },
			},
			error: null,
		});
		await expect(repository.recommendation(id)).rejects.toThrow();
		builder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
		await expect(repository.recommendation(id)).rejects.toMatchObject({ code: "NotFound" });
		builder.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
		await expect(repository.recommendation(id)).rejects.toMatchObject({ code: "Forbidden" });
	});
});

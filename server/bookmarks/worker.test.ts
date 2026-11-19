import { afterEach, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/types/supabase";

vi.mock("./raindrop", async (importOriginal) => ({
	...(await importOriginal<typeof import("./raindrop")>()),
	readRaindrop: vi.fn(),
	raindropManifest: vi.fn(),
}));

import { raindropManifest, readRaindrop } from "./raindrop";
import { runBookmarkWorker } from "./worker";

const job = {
	id: "aaaaaaaa-0000-4000-8000-000000000001",
	kind: "import",
	state: "processing",
	scope: {},
	progress: { phase: "manifest", accountId: "111", page: 0 },
	total: 2,
	completed: 1,
	failed: 0,
	attempts: 1,
	available_at: new Date().toISOString(),
	lease_token: "cccccccc-0000-4000-8000-000000000001",
	lease_expires_at: new Date(Date.now() + 90000).toISOString(),
	error: null,
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
};

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});
it("resumed import refuses a different account before reading or storing its manifest", async () => {
	vi.stubEnv("RAINDROP_IMPORT_TOKEN", "test-only-token");
	vi.mocked(readRaindrop).mockResolvedValue({ result: true, user: { _id: 222 } });

	const rpc = vi
		.fn()
		.mockResolvedValueOnce({
			data: { job, items: [], collections: [], settings: { interests: [], interest_version: 1 } },
			error: null,
		})
		.mockResolvedValueOnce({ data: true, error: null })
		.mockResolvedValueOnce({ data: null, error: null });
	expect((await runBookmarkWorker({ rpc } as unknown as AppSupabaseClient)).claimedCount).toBe(1);
	expect(raindropManifest).not.toHaveBeenCalled();
	expect(rpc.mock.calls[1]?.[1]?.p_result).toMatchObject({ state: "paused" });
	expect(rpc.mock.calls[1]?.[1]?.p_result).not.toHaveProperty("importCollections");
});

it.each(["missing-key", "budget-denied", "uncertain-request", "excessive-cost"])(
	"Jev %s never bypasses reservation or silently repeats an uncertain charge",
	async (scenario) => {
		vi.stubEnv("OPENROUTER_API_KEY", scenario === "missing-key" ? "" : "fixture-only");
		const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network interrupted"));
		if (scenario === "excessive-cost")
			fetch.mockResolvedValue(
				Response.json({
					model: "typesafe/jev-1.13-20260917",
					usage: { input_tokens: 100, output_tokens: 20, cost: 1.2 },
					answers: {
						collection: {
							type: "choice",
							choice: "unfiled",
							confidence: 1,
							probabilities: { unfiled: 1 },
						},
						basis: {
							type: "choice",
							choice: "uncertain",
							confidence: 1,
							probabilities: { topic: 0, url: 0, uncertain: 1 },
						},
					},
				})
			);
		const rpc = vi.fn().mockImplementation(async (command) => {
			if (command === "bookmark_worker_claim")
				return {
					data: {
						job: {
							...job,
							kind: "recommend",
							scope: { url: "https://example.com/ai", title: "AI" },
							progress: {},
						},
						items: [],
						collections: [],
						settings: { interests: [], interest_version: 1 },
					},
					error: null,
				};
			return {
				data: command !== "bookmark_ai_reserve" || scenario !== "budget-denied",
				error: null,
			};
		});
		expect((await runBookmarkWorker({ rpc } as unknown as AppSupabaseClient)).claimedCount).toBe(1);
		const committed = rpc.mock.calls.find(([command]) => command === "bookmark_worker_commit")?.[1]
			?.p_result;
		expect(committed).toMatchObject({ state: "paused" });
		if (["uncertain-request", "excessive-cost"].includes(scenario)) {
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(committed).toMatchObject({
				reservationState: "uncertain",
				progress: { provider: "openrouter", usageUncertain: true },
			});
			if (scenario === "excessive-cost") expect(committed.chargedNano).toBe(1200000000);
			else expect(committed).not.toHaveProperty("chargedNano");
			expect(
				rpc.mock.calls.find(([command]) => command === "bookmark_ai_reserve")?.[1]?.p_amount
			).toBe(2752512);
			expect(
				rpc.mock.calls.find(([command]) => command === "bookmark_ai_reserve")?.[1]
			).toMatchObject({
				p_provider: "openrouter",
				p_model: "typesafe/jev-1.13",
			});
		} else {
			expect(fetch).not.toHaveBeenCalled();
			expect(committed).not.toHaveProperty("reservationId");
		}
	}
);

it("records the GPT request identity before a lost response can pause the job", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("request timed out"));
	const rpc = vi.fn().mockImplementation(async (command) => ({
		data:
			command === "bookmark_worker_claim"
				? {
						job: { ...job, kind: "interests", progress: {} },
						items: [],
						collections: [],
						settings: { interests: [], interest_version: 1 },
					}
				: command === "bookmark_worker_context"
					? {
							importedCount: 0,
							importCollections: [],
							verifiedCount: 0,
							missingSourceCount: 0,
							extraSourceCount: 0,
							changedMembershipCount: 0,
							collectionCount: 0,
							missingMembershipCount: 0,
							tagCounts: [],
						}
					: true,
		error: null,
	}));
	await runBookmarkWorker({ rpc } as unknown as AppSupabaseClient);
	expect(rpc.mock.calls.find(([command]) => command === "bookmark_ai_reserve")?.[1]).toMatchObject({
		p_provider: "openrouter",
		p_model: "openai/gpt-6-luna",
		p_amount: 20096000,
	});
	expect(
		rpc.mock.calls.find(([command]) => command === "bookmark_worker_commit")?.[1]?.p_result
	).toMatchObject({ reservationState: "uncertain", state: "paused" });
});

it.each(["interests", "classify"])(
	"invalid %s task output settles usage and fails without another paid automatic retry",
	async (kind) => {
		vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
		const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({
				status: "completed",
				output: [
					{
						type: "message",
						content: [
							{
								type: "output_text",
								text: JSON.stringify({
									items: [
										{
											id: "unexpected",
											collectionId: null,
											newCollectionName: null,
											reason: "invalid task target",
											relevance: null,
											reviewCandidate: false,
										},
									],
									interests: [],
								}),
							},
						],
					},
				],
				usage: { input_tokens: 100, output_tokens: 20, cost: 0.00002 },
			})
		);
		const rpc = vi.fn().mockImplementation(async (command) => ({
			data:
				command === "bookmark_worker_claim"
					? {
							job: { ...job, kind, progress: {} },
							items: [],
							collections: [],
							settings: { interests: [], interest_version: 1 },
						}
					: command === "bookmark_worker_context"
						? {
								importedCount: 0,
								importCollections: [],
								verifiedCount: 0,
								missingSourceCount: 0,
								extraSourceCount: 0,
								changedMembershipCount: 0,
								collectionCount: 0,
								missingMembershipCount: 0,
								tagCounts: [],
							}
						: true,
			error: null,
		}));
		await runBookmarkWorker({ rpc } as unknown as AppSupabaseClient);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(
			rpc.mock.calls.find(([command]) => command === "bookmark_worker_commit")?.[1]?.p_result
		).toMatchObject({ state: "failed", reservationState: "settled", chargedNano: 20000 });
	}
);

it.each(["budget-denied", "excessive-cost"])(
	"GPT %s respects the full input/output reservation and retains a known overrun",
	async (scenario) => {
		vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
		const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({
				status: "completed",
				output: [],
				usage: { input_tokens: 100, output_tokens: 20, cost: 1.2 },
			})
		);
		const rpc = vi.fn().mockImplementation(async (command) => {
			if (command === "bookmark_worker_claim")
				return {
					data: {
						job: { ...job, kind: "classify", progress: {} },
						items: [],
						collections: [],
						settings: { interests: [], interest_version: 1 },
					},
					error: null,
				};
			return {
				data: command !== "bookmark_ai_reserve" || scenario !== "budget-denied",
				error: null,
			};
		});
		await runBookmarkWorker({ rpc } as unknown as AppSupabaseClient);
		expect(rpc).toHaveBeenCalledWith(
			"bookmark_ai_reserve",
			expect.objectContaining({ p_tokens: 128000, p_amount: 20096000 })
		);
		const committed = rpc.mock.calls.find(([command]) => command === "bookmark_worker_commit")?.[1]
			?.p_result;
		expect(committed.state).toBe("paused");
		if (scenario === "budget-denied") expect(fetch).not.toHaveBeenCalled();
		else {
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(committed).toMatchObject({ chargedNano: 1200000000, reservationState: "uncertain" });
		}
	}
);

it.each([
	"topic",
	"etc",
	"missing-etc",
	"already-etc",
	"source-folder",
	"missing-source-kind",
] as const)("classify commits the validated topic decision for %s", async (scenario) => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	const id = "aaaaaaaa-0000-4000-8000-000000000010";
	const sourceId = "aaaaaaaa-0000-4000-8000-000000000011";
	const topicId = "aaaaaaaa-0000-4000-8000-000000000012";
	const etcId = "aaaaaaaa-0000-4000-8000-000000000013";
	const url = "https://arca.live/b/bluearchive/123";
	const collection = (id: string, name: string, parent_id: string | null = null) => ({
		id,
		name,
		parent_id,
		version: 1,
		sort_order: 1,
		source_id: null,
		original: null,
		created_at: job.created_at,
	});
	const selection = scenario === "topic" ? topicId : scenario === "source-folder" ? sourceId : null;
	const modelItem = {
		id,
		collectionId: selection,
		newCollectionName: scenario === "etc" ? "게시판 잡담" : null,
		reason: "글의 주제 근거",
		relevance: null,
		reviewCandidate: false,
		...(scenario === "missing-source-kind" ? {} : { sourceKind: "unknown" }),
	};
	const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({
			status: "completed",
			output: [
				{
					type: "message",
					content: [
						{ type: "output_text", text: JSON.stringify({ items: [modelItem], interests: [] }) },
					],
				},
			],
			usage: { input_tokens: 100, output_tokens: 20, cost: 0.00002 },
		})
	);
	const rpc = vi.fn().mockImplementation(async (command) => ({
		data:
			command === "bookmark_worker_claim"
				? {
						job: { ...job, kind: "classify", progress: {} },
						items: [
							{
								id,
								url,
								url_key: url,
								title: "블아 공략",
								description: "",
								tags: [],
								note: "",
								collection_id: scenario === "already-etc" ? etcId : null,
								state: "library",
								version: 1,
								expected_version: 1,
								review_revision: 1,
								source_id: null,
								source_thread_id: null,
								original: null,
								previous: null,
								saved_at: job.created_at,
								created_at: job.created_at,
								updated_at: job.updated_at,
								opened_at: null,
								open_count: 0,
							},
						],
						collections: [
							collection(sourceId, "arcalive"),
							collection(topicId, "블루 아카이브", sourceId),
							...(scenario === "missing-etc" ? [] : [collection(etcId, "etc")]),
						],
						settings: { interests: [], interest_version: 1 },
					}
				: true,
		error: null,
	}));
	await runBookmarkWorker({ rpc } as unknown as AppSupabaseClient);
	const charge = rpc.mock.calls.find(([command]) => command === "bookmark_worker_commit")?.[1]
		?.p_result;
	expect(charge).toMatchObject({ reservationState: "settled", chargedNano: 20000 });
	if (scenario === "missing-source-kind" || scenario === "source-folder") {
		expect(charge.state).toBe("failed");
		expect(charge.items?.[0] ?? {}).not.toHaveProperty("proposal");
		return;
	}
	const input = JSON.parse(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).input);
	expect(input.collections).toEqual([
		expect.objectContaining({ id: topicId, path: "arcalive / 블루 아카이브" }),
	]);
	if (scenario === "topic" || scenario === "etc") {
		expect(charge.items[0].proposal).toMatchObject({
			collectionId: scenario === "topic" ? topicId : etcId,
			newCollectionName: null,
			reason:
				scenario === "topic"
					? modelItem.reason
					: "맞는 주제 컬렉션이 없어 커뮤니티 글을 etc에 제안했습니다.",
		});
	} else {
		expect(charge.items[0]).toHaveProperty("result.reason");
		expect(charge.items[0]).not.toHaveProperty("proposal");
	}
});

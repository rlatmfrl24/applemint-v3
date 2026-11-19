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

const classificationScenarios = [
	"topic",
	"source",
	"already-source",
	"etc",
	"missing-etc",
	"already-etc",
	"root-etc",
	"source-folder",
	"missing-source-kind",
] as const;

function classificationScenarioURL(scenario: string) {
	if (scenario === "unfiled") return "ftp://example.org/misc";
	if (scenario === "root-etc") return "https://example.org/misc";
	return "https://arca.live/b/bluearchive/123";
}

function classificationFixture(origin: string, scenario: string) {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	const id = "aaaaaaaa-0000-4000-8000-000000000010";
	const sourceId = "aaaaaaaa-0000-4000-8000-000000000011";
	const topicId = "aaaaaaaa-0000-4000-8000-000000000012";
	const etcId = "aaaaaaaa-0000-4000-8000-000000000013";
	const parentId = "aaaaaaaa-0000-4000-8000-000000000014";
	const rootEtcId = "aaaaaaaa-0000-4000-8000-000000000015";
	const sourceFolderId = "aaaaaaaa-0000-4000-8000-000000000016";
	const url = classificationScenarioURL(scenario);
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
	const selections: Record<string, string> = {
		topic: topicId,
		"already-topic": topicId,
		uncertain: topicId,
		"source-folder": sourceId,
	};
	const memberships: Record<string, string> = {
		"already-etc": etcId,
		"already-source": sourceFolderId,
		"already-topic": topicId,
	};
	const selection = selections[scenario] ?? null;
	const modelItem = {
		id,
		collectionId: selection,
		newCollectionName: selection ? null : "새 주제 후보",
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
			usage: {
				input_tokens: 100,
				output_tokens: 20,
				...(scenario === "uncertain" ? {} : { cost: 0.00002 }),
			},
		})
	);
	const claim = {
		job: { ...job, kind: "classify", scope: { origin }, progress: {} },
		items: [
			{
				id,
				url,
				url_key: url,
				title: "블아 공략",
				description: "",
				tags: [],
				note: "",
				collection_id: memberships[scenario] ?? null,
				state: scenario === "trashed" ? "trash" : "library",
				version: scenario === "edited" ? 2 : 1,
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
			collection(parentId, "Community"),
			collection(rootEtcId, "etc"),
			...(scenario === "source" || scenario === "already-source"
				? [collection(sourceFolderId, "arcalive", parentId)]
				: []),
			...(scenario === "missing-etc" ? [] : [collection(etcId, "etc", parentId)]),
		],
		settings: { interests: [], interest_version: 1 },
	};
	const rpc = vi.fn().mockImplementation(async (command) => {
		if (command === "bookmark_worker_claim") return { data: claim, error: null };
		if (command === "bookmark_scheduled_classification_reserve")
			return { data: scenario === "disabled" ? "disabled" : "reserved", error: null };
		return { data: true, error: null };
	});
	return { rpc, fetch, modelItem, id, topicId, sourceFolderId, rootEtcId, etcId };
}

it.each([
	...classificationScenarios.map((scenario) => ["manual", scenario] as const),
	...[
		...classificationScenarios,
		"already-topic",
		"unfiled",
		"edited",
		"trashed",
		"disabled",
		"uncertain",
	].map((scenario) => ["scheduled-classify", scenario] as const),
] as const)("%s classify commits the validated decision for %s", async (origin, scenario) => {
	const { rpc, fetch, modelItem, id, topicId, sourceFolderId, rootEtcId, etcId } =
		classificationFixture(origin, scenario);
	await runBookmarkWorker({ rpc } as unknown as AppSupabaseClient);
	const charge = rpc.mock.calls.find(([command]) => command === "bookmark_worker_commit")?.[1]
		?.p_result;
	if (["disabled", "edited", "trashed"].includes(scenario)) {
		expect(fetch).not.toHaveBeenCalled();
		expect(charge).not.toHaveProperty("reservationId");
		if (scenario === "disabled") expect(charge).toMatchObject({ state: "retry" });
		else expect(charge.items).toEqual([expect.objectContaining({ id, state: "failed" })]);
		return;
	}
	if (origin === "scheduled-classify") {
		expect(rpc.mock.calls.map(([command]) => command)).toContain(
			"bookmark_scheduled_classification_reserve"
		);
	}
	if (scenario === "uncertain") {
		expect(charge).toMatchObject({
			state: "paused",
			reservationState: "uncertain",
			items: [
				expect.objectContaining({ proposal: expect.objectContaining({ collectionId: topicId }) }),
			],
		});
		return;
	}
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
	if (
		["missing-etc", "already-etc", "already-source", "already-topic", "unfiled"].includes(scenario)
	) {
		expect(charge.items[0]).toHaveProperty("result.reason");
		expect(charge.items[0]).not.toHaveProperty("proposal");
		return;
	}
	const expected = {
		topic: { collectionId: topicId, etcScope: null, reason: modelItem.reason },
		source: {
			collectionId: sourceFolderId,
			etcScope: null,
			sourceRoute: { siteKey: "arca.live" },
			reason: "맞는 주제 컬렉션이 없어 Community / arcalive로 이동을 제안했습니다.",
		},
		etc: {
			collectionId: etcId,
			etcScope: "community",
			reason: "맞는 주제 컬렉션이 없어 Community / etc로 이동을 제안했습니다.",
		},
		"root-etc": {
			collectionId: rootEtcId,
			etcScope: "root",
			reason: "맞는 주제 컬렉션이 없어 최상위 etc로 이동을 제안했습니다.",
		},
	};
	expect(charge.items[0].proposal).toMatchObject({
		...expected[scenario as keyof typeof expected],
		newCollectionName: null,
	});
});

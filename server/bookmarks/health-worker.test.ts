import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bookmarkJobSchema } from "@/contracts/bookmark.schema";
import type { AppSupabaseClient } from "@/types/supabase";
import { type HealthObservation, inspectBookmarkPage } from "./health";
import { extractHealthContent } from "./health-content";
import { callHealthDecision } from "./health-decision";
import { probeHealthMedia } from "./health-media";
import { type HealthClaim, type HealthWork, processHealthClaim } from "./health-worker";

vi.mock("./health", async (original) => ({
	...(await original<typeof import("./health")>()),
	inspectBookmarkPage: vi.fn(),
}));
vi.mock("./health-media", async (original) => ({
	...(await original<typeof import("./health-media")>()),
	probeHealthMedia: vi.fn(),
}));
vi.mock("./health-decision", async (original) => ({
	...(await original<typeof import("./health-decision")>()),
	callHealthDecision: vi.fn(),
}));
const id = "bbbbbbbb-9800-4000-8000-000000000001";
const reservation = "eeeeeeee-9800-4000-8000-000000000001";
const job = bookmarkJobSchema.parse({
	id: "aaaaaaaa-9800-4000-8000-000000000001",
	kind: "check",
	state: "processing",
	scope: {},
	progress: {},
	total: 2,
	completed: 0,
	failed: 0,
	attempts: 1,
	available_at: "2026-10-22T00:00:00Z",
	lease_token: "cccccccc-9800-4000-8000-000000000001",
	lease_expires_at: "2026-10-22T00:01:30Z",
	error: null,
	created_at: "2026-10-22T00:00:00Z",
	updated_at: "2026-10-22T00:00:00Z",
});
function observation(body = "<main>내용이 삭제되었습니다.</main>"): HealthObservation {
	return {
		...extractHealthContent({ body, finalUrl: "https://example.com/post", truncated: false }),
		input: {
			bookmarkId: id,
			url: "https://example.com/post",
			version: 1,
			baseline: null,
			decisionSample: false,
		},
		reachability: {
			status: "healthy",
			reason: "HTTP 200",
			finalUrl: "https://example.com/post",
			httpStatus: 200,
		},
	};
}
function claim(phase: HealthWork["phase"] = "page", obs = observation()): HealthClaim {
	return {
		job,
		item: {
			id,
			url: "https://example.com/post",
			title: "Original post",
			version: 1,
			expected_version: 1,
			work:
				phase === "page"
					? null
					: {
							phase,
							observation: obs,
							mediaCursor: 0,
							reservationId: null,
							evidenceKey: null,
							confirmAfter: null,
							confirmationFingerprint: null,
							confirmationFirstObservedAt: null,
							confirmationAttempts: 0,
						},
		},
		baseline: null,
	};
}
function db(state = "reserved") {
	const rpc = vi.fn(async (name: string) => ({
		data:
			name === "bookmark_health_ai_reserve"
				? {
						state,
						reservationId: reservation,
						decision:
							state === "cached"
								? { choice: "present", basis: "content_match", confidence: 1 }
								: null,
						retryAt: "2026-10-31T15:00:00Z",
					}
				: true,
		error: null,
	}));
	return { client: { rpc } as unknown as AppSupabaseClient, rpc };
}
beforeEach(() => {
	vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-22T00:00:00Z"));
	vi.mocked(inspectBookmarkPage).mockResolvedValue(observation());
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});
it("persists the page phase without repeating it during media work", async () => {
	const { client } = db();
	const result = await processHealthClaim(client, claim());
	expect(result.items[0].work?.phase).toBe("decision");
	expect(inspectBookmarkPage).toHaveBeenCalledOnce();
});
it("stores a cursor after at most two media probes", async () => {
	const obs = observation(
		'<article><img src="/1.jpg"><img src="/2.jpg"><img src="/3.jpg"></article>'
	);
	vi.mocked(probeHealthMedia).mockImplementation(async (ref) => ({
		kind: ref.kind,
		label: ref.label,
		urlHash: ref.urlHash,
		state: "reachable",
		httpStatus: 200,
		reasonCode: "MEDIA_SEMANTICS_UNVERIFIED",
	}));
	const result = await processHealthClaim(db().client, claim("media", obs));
	expect(result.items[0].work?.mediaCursor).toBe(2);
	expect(probeHealthMedia).toHaveBeenCalledTimes(2);
	expect(inspectBookmarkPage).not.toHaveBeenCalled();
});
it("budget wait does not consume a model request", async () => {
	const result = await processHealthClaim(db("budget_wait").client, claim("decision"));
	expect(result.items[0].state).toBe("waiting");
	expect(result.items[0].availableAt).toBe("2026-10-31T15:00:00Z");
	expect(callHealthDecision).not.toHaveBeenCalled();
});
it("uncertain health request fails only its item", async () => {
	vi.mocked(callHealthDecision).mockRejectedValue(new Error("lost response"));
	const store = db();
	const result = await processHealthClaim(store.client, claim("decision"));
	expect(result.items[0].state).toBe("failed");
	expect(result.items[0].check?.evidence.ai.state).toBe("uncertain");
	expect(store.rpc).toHaveBeenCalledWith(
		"bookmark_health_ai_settle",
		expect.objectContaining({ p_result: expect.objectContaining({ state: "uncertain" }) })
	);
});
it("same evidence reuses a settled result", async () => {
	const result = await processHealthClaim(db("cached").client, claim("decision"));
	expect(result.items[0].state).toBe("done");
	expect(result.items[0].check?.evidence.content.status).toBe("present");
	expect(callHealthDecision).not.toHaveBeenCalled();
});
it("known invalid output still settles its receipt", async () => {
	vi.mocked(callHealthDecision).mockResolvedValue({
		choice: null,
		basis: null,
		confidence: null,
		chargedNano: 42000,
		inputTokens: 100,
		outputTokens: 0,
		outputError: "INVALID_ANSWERS",
	});
	const store = db();
	const result = await processHealthClaim(store.client, claim("decision"));
	expect(result.items[0].state).toBe("failed");
	expect(store.rpc).toHaveBeenCalledWith(
		"bookmark_health_ai_settle",
		expect.objectContaining({
			p_result: expect.objectContaining({ state: "settled", chargedNano: 42000 }),
		})
	);
});
it("content and media suspicion waits 24 hours while HTTP death waits one minute", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "");
	const content = await processHealthClaim(db().client, claim("decision"));
	expect(content.items[0].availableAt).toBe("2026-10-23T00:00:00.000Z");
	const obs = observation();
	obs.reachability.status = "dead";
	obs.reachability.httpStatus = 404;
	vi.mocked(inspectBookmarkPage).mockResolvedValue(obs);
	const death = await processHealthClaim(db().client, claim());
	expect(death.items[0].availableAt).toBe("2026-10-22T00:01:00.000Z");
});
it("keeps a known receipt in the commit when settlement transport fails", async () => {
	vi.mocked(callHealthDecision).mockResolvedValue({
		choice: "present",
		basis: "content_match",
		confidence: 1,
		chargedNano: 42000,
		inputTokens: 100,
		outputTokens: 20,
		outputError: null,
	});
	const store = db();
	store.rpc.mockImplementation(async (name) =>
		name === "bookmark_health_ai_settle"
			? ({ data: null, error: { message: "connection lost" } } as never)
			: ({
					data: { state: "reserved", reservationId: reservation, decision: null, retryAt: null },
					error: null,
				} as never)
	);
	const result = await processHealthClaim(store.client, claim("decision"));
	expect(result).toMatchObject({
		receipt: { reservationId: reservation, result: { chargedNano: 42000 } },
	});
	expect(result.items[0].state).toBe("failed");
	expect(callHealthDecision).toHaveBeenCalledOnce();
});
it("an excessive receipt blocks applying the model decision", async () => {
	vi.mocked(callHealthDecision).mockResolvedValue({
		choice: "present",
		basis: "content_match",
		confidence: 1,
		chargedNano: 3000000,
		inputTokens: 100,
		outputTokens: 20,
		outputError: null,
	});
	const result = await processHealthClaim(db().client, claim("decision"));
	expect(result.items[0].state).toBe("failed");
	expect(result.items[0].check?.evidence.ai.state).toBe("uncertain");
});
it("restarts after a media permit wait without fetching the page again", async () => {
	const { HealthRequestDeferred } = await import("./safe-fetch");
	const obs = observation(
		'<article><img src="/1.jpg"><img src="/2.jpg"><img src="/3.jpg"></article>'
	);
	vi.mocked(probeHealthMedia)
		.mockResolvedValueOnce({
			kind: "image",
			label: "/1.jpg",
			urlHash: obs.mediaRefs[0].urlHash,
			state: "reachable",
			httpStatus: 200,
			reasonCode: "MEDIA_SEMANTICS_UNVERIFIED",
		})
		.mockRejectedValueOnce(new HealthRequestDeferred("2026-10-22T00:00:02Z"));
	const first = await processHealthClaim(db().client, claim("media", obs));
	expect(first.items[0]).toMatchObject({ state: "waiting", work: { mediaCursor: 1 } });
	vi.mocked(probeHealthMedia).mockImplementation(async (ref) => ({
		kind: ref.kind,
		label: ref.label,
		urlHash: ref.urlHash,
		state: "reachable",
		httpStatus: 200,
		reasonCode: "MEDIA_SEMANTICS_UNVERIFIED",
	}));
	const next = claim("media");
	next.item.work = first.items[0].work;
	const result = await processHealthClaim(db().client, next);
	expect(result.items[0].work?.mediaCursor).toBe(3);
	expect(inspectBookmarkPage).not.toHaveBeenCalled();
});
it("confirms only after the full interval and finishes a restricted response that recovers", async () => {
	vi.stubEnv("OPENROUTER_API_KEY", "");
	const first = await processHealthClaim(db().client, claim("decision"));
	const next = claim("confirm");
	next.item.work = first.items[0].work;
	expect((await processHealthClaim(db().client, next)).items[0].state).toBe("waiting");
	expect(inspectBookmarkPage).not.toHaveBeenCalled();
	vi.advanceTimersByTime(86400000);
	vi.mocked(inspectBookmarkPage).mockResolvedValue(observation());
	const second = await processHealthClaim(db().client, next);
	next.item.work = second.items[0].work;
	const final = await processHealthClaim(db().client, next);
	expect(final.items[0].check?.evidence.confirmation).toBe("repeated");
	expect(final.items[0].state).toBe("done");
	const recovered = observation("<article><h1>Recovered</h1>Real body</article>");
	vi.mocked(inspectBookmarkPage).mockResolvedValue(recovered);
	next.item.work = first.items[0].work;
	const page = await processHealthClaim(db().client, next);
	next.item.work = page.items[0].work;
	expect(
		(await processHealthClaim(db().client, next)).items[0].check?.evidence.content.status
	).toBe("present");
});
it("bounds multibyte evidence without losing media counts", async () => {
	const obs = observation(
		"<article><h1>Healthy</h1>" + "가".repeat(600) + '<img src="/1.jpg"></article>'
	);
	obs.evidence.content.title = "가".repeat(1000);
	obs.evidence.content.excerpt = "나".repeat(500);
	obs.mediaRefs = [];
	obs.evidence.media = {
		...obs.evidence.media,
		discovered: 20,
		checked: 20,
		reachable: 20,
		status: "present",
		items: Array.from({ length: 20 }, (_, i) => ({
			kind: "image" as const,
			label: "미디어".repeat(53),
			urlHash: i.toString(16).padStart(64, "0"),
			state: "reachable" as const,
			httpStatus: 200,
			reasonCode: "MEDIA_SEMANTICS_UNVERIFIED",
		})),
	};
	vi.stubEnv("OPENROUTER_API_KEY", "");
	const result = await processHealthClaim(db().client, claim("decision", obs));
	expect(result.items[0].state).toBe("done");
	expect(Buffer.byteLength(JSON.stringify(result.items[0].check?.evidence))).toBeLessThanOrEqual(
		8192
	);
	expect(result.items[0].check?.evidence.media.checked).toBe(20);
});
it("persists a deferred redirect across the next page claim", async () => {
	const { HealthRequestDeferred } = await import("./safe-fetch");
	const continuation = { url: "https://example.com/final", redirects: 1 };
	vi.mocked(inspectBookmarkPage).mockRejectedValueOnce(
		Object.assign(new HealthRequestDeferred("2026-10-22T00:00:02Z"), { continuation })
	);
	const first = await processHealthClaim(db().client, claim());
	expect(first.items[0].work).toMatchObject({ requestContinuation: continuation });
	const next = claim();
	next.item.work = first.items[0].work;
	await processHealthClaim(db().client, next);
	expect(inspectBookmarkPage).toHaveBeenLastCalledWith(
		expect.anything(),
		expect.objectContaining({ continuation })
	);
});

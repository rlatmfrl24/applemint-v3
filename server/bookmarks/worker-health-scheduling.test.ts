import { afterEach, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/types/supabase";
import { processHealthClaim } from "./health-worker";
import { runBookmarkWorker } from "./worker";

vi.mock("./health-worker", () => ({ processHealthClaim: vi.fn() }));
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});
it.each([
	{ delay: 2000, otherReady: false },
	{ delay: 86400000, otherReady: false },
	{ delay: 2000, otherReady: true },
])(
	"only waits for a known health retry inside the invocation deadline: $delay, otherReady=$otherReady",
	async ({ delay, otherReady }) => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-22T00:00:00Z"));
		const time = new Date().toISOString();
		const id = "bbbbbbbb-9870-4000-8000-000000000001";
		const claim = {
			job: {
				id: "aaaaaaaa-9870-4000-8000-000000000001",
				kind: "check",
				state: "processing",
				scope: {},
				progress: {},
				total: 1,
				completed: 0,
				failed: 0,
				attempts: 1,
				available_at: time,
				lease_token: "cccccccc-9870-4000-8000-000000000001",
				lease_expires_at: time,
				error: null,
				created_at: time,
				updated_at: time,
			},
			items: [
				{
					id,
					url: "https://example.com/health",
					url_key: "https://example.com/health",
					title: "Health",
					description: "",
					tags: [],
					note: "",
					collection_id: null,
					state: "library",
					version: 1,
					source_id: null,
					source_thread_id: null,
					original: null,
					saved_at: time,
					created_at: time,
					updated_at: time,
					opened_at: null,
					open_count: 0,
					review_revision: 1,
					expected_version: 1,
					previous: null,
					work: null,
				},
			],
			collections: [],
			settings: { interests: [], interest_version: 1 },
		};
		const waiting = {
			items: [
				{
					id,
					version: 1,
					state: "waiting" as const,
					work: null,
					availableAt: new Date(Date.now() + delay).toISOString(),
				},
			],
		};
		vi.mocked(processHealthClaim).mockReset().mockResolvedValueOnce(waiting);
		if (otherReady)
			vi.mocked(processHealthClaim).mockImplementationOnce(async () => {
				vi.setSystemTime(new Date(Date.parse(time) + 3000));
				return {
					items: [{ ...waiting.items[0], availableAt: new Date(Date.now() + 2000).toISOString() }],
				};
			});
		vi.mocked(processHealthClaim).mockResolvedValueOnce({
			items: [{ id, version: 1, state: "done", work: null }],
		});
		let claims = 0;
		const sequence = otherReady ? [true, true, false, true, false] : [true, false, true, false];
		const rpc = vi.fn(async (name: string) => ({
			data: name === "bookmark_worker_claim" ? (sequence[claims++] ? claim : null) : true,
			error: null,
		}));
		const result = runBookmarkWorker({ rpc } as unknown as AppSupabaseClient);
		await vi.runAllTimersAsync();
		expect((await result).claimedCount).toBe(otherReady ? 3 : delay === 2000 ? 2 : 1);
		expect(Date.now() - Date.parse(time)).toBe(otherReady ? 5000 : delay === 2000 ? 2000 : 0);
	}
);

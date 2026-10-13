import { afterEach, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/types/supabase";

vi.mock("./raindrop", async (importOriginal) => ({
	...(await importOriginal<typeof import("./raindrop")>()),
	readRaindrop: vi.fn(),
	raindropManifest: vi.fn(),
}));

import { raindropManifest, readRaindrop } from "./raindrop";
import { runBookmarkWorker } from "./worker";

afterEach(() => vi.unstubAllEnvs());
it("resumed import refuses a different account before reading or storing its manifest", async () => {
	vi.stubEnv("RAINDROP_IMPORT_TOKEN", "test-only-token");
	vi.mocked(readRaindrop).mockResolvedValue({ result: true, user: { _id: 222 } });
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

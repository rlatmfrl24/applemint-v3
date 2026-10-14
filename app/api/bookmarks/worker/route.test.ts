import type { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), worker: vi.fn() }));
vi.mock("@/utils/supabase/service-role", () => ({ createServiceRoleClient: mocks.client }));
vi.mock("@/server/bookmarks/worker", () => ({ runBookmarkWorker: mocks.worker }));

import { POST } from "./route";

const secret = "0123456789abcdef0123456789abcdef";
function request(value = secret) {
	return new Request("http://localhost/api/bookmarks/worker", {
		method: "POST",
		headers: { "x-applemint-internal-secret": value },
		body: "{}",
	}) as NextRequest;
}
beforeEach(() => {
	vi.stubEnv("CRAWL_INTERNAL_SECRET", secret);
	mocks.client.mockReset().mockReturnValue({ worker: true });
	mocks.worker.mockReset().mockResolvedValue({ claimedCount: 0, leaseRejectedCount: 0 });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects unauthenticated calls before creating a privileged client", async () => {
	expect((await POST(request("wrong"))).status).toBe(401);
	expect(mocks.client).not.toHaveBeenCalled();
	expect(mocks.worker).not.toHaveBeenCalled();
});
it("fails closed when the server secret is absent", async () => {
	vi.stubEnv("CRAWL_INTERNAL_SECRET", "");
	expect((await POST(request())).status).toBe(503);
	expect(mocks.client).not.toHaveBeenCalled();
});
it("uses the privileged client only after internal authentication", async () => {
	expect((await POST(request())).status).toBe(200);
	expect(mocks.worker).toHaveBeenCalledWith({ worker: true });
});
it("does not expose provider or database errors", async () => {
	mocks.worker.mockRejectedValue(new Error("private-provider-payload"));
	const response = await POST(request());
	expect(response.status).toBe(500);
	expect(await response.text()).not.toContain("private-provider-payload");
});

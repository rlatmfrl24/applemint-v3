import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createServiceRoleClientMock = vi.hoisted(() => vi.fn());
const runYouTubeEnrichmentWorkerMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/service-role", () => ({
	createServiceRoleClient: createServiceRoleClientMock,
}));
vi.mock("../worker", () => ({
	runYouTubeEnrichmentWorker: runYouTubeEnrichmentWorkerMock,
	YouTubeWorkerError: class extends Error {
		constructor(readonly code: string) {
			super(code);
		}
	},
}));

import { POST } from "./route";

const INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";

function request(secret = INTERNAL_SECRET, body: Record<string, unknown> = {}) {
	return new Request("http://localhost/api/media/youtube/enrich", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-applemint-internal-secret": secret,
		},
		body: JSON.stringify(body),
	}) as NextRequest;
}

describe("POST /api/media/youtube/enrich", () => {
	beforeEach(() => {
		vi.stubEnv("CRAWL_INTERNAL_SECRET", INTERNAL_SECRET);
		vi.stubEnv("YOUTUBE_API_KEY", "fixture-api-key");
		createServiceRoleClientMock.mockReset();
		createServiceRoleClientMock.mockReturnValue({ kind: "service-role-client" });
		runYouTubeEnrichmentWorkerMock.mockReset();
		runYouTubeEnrichmentWorkerMock.mockResolvedValue({
			claimedCount: 0,
			readyCount: 0,
		});
	});

	afterEach(() => vi.unstubAllEnvs());

	it("constant-time helper 계약으로 잘못된 internal secret을 거부한다", async () => {
		const response = await POST(request("wrong-secret"));

		expect(response.status).toBe(401);
		expect(createServiceRoleClientMock).not.toHaveBeenCalled();
		expect(runYouTubeEnrichmentWorkerMock).not.toHaveBeenCalled();
	});

	it("YOUTUBE_API_KEY가 없거나 비어 있으면 503이며 queue를 claim하지 않는다", async () => {
		vi.stubEnv("YOUTUBE_API_KEY", "   ");

		const response = await POST(request());

		expect(response.status).toBe(503);
		expect(createServiceRoleClientMock).not.toHaveBeenCalled();
		expect(runYouTubeEnrichmentWorkerMock).not.toHaveBeenCalled();
	});

	it("검증된 요청만 service-role worker에 제한된 batch 크기로 전달한다", async () => {
		const response = await POST(request(INTERNAL_SECRET, { limit: 7 }));

		expect(response.status).toBe(200);
		expect(runYouTubeEnrichmentWorkerMock).toHaveBeenCalledWith(
			createServiceRoleClientMock.mock.results[0].value,
			{ apiKey: "fixture-api-key", limit: 7 }
		);
	});

	it("잘못된 limit과 service-role 설정 오류를 fail closed한다", async () => {
		expect((await POST(request(INTERNAL_SECRET, { limit: 51 }))).status).toBe(400);
		expect(createServiceRoleClientMock).not.toHaveBeenCalled();

		createServiceRoleClientMock.mockImplementationOnce(() => {
			throw new Error("missing service role");
		});
		const response = await POST(request());
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ reason: "configuration-missing" });
	});
});

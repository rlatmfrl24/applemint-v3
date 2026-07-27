import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMediaWorkerResult } from "@/test/support/crawl";

const createServiceRoleClientMock = vi.hoisted(() => vi.fn());
const runImgurEnrichmentWorkerMock = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/service-role", () => ({
	createServiceRoleClient: createServiceRoleClientMock,
}));
vi.mock("../worker", () => ({
	IMGUR_MAX_BATCH_SIZE: 4,
	runImgurEnrichmentWorker: runImgurEnrichmentWorkerMock,
	ImgurWorkerError: class extends Error {
		constructor(readonly code: string) {
			super(code);
		}
	},
}));

import { POST } from "./route";

const INTERNAL_SECRET = "0123456789abcdef0123456789abcdef";

function request(secret = INTERNAL_SECRET, body: Record<string, unknown> = {}) {
	return new Request("http://localhost/api/media/imgur/enrich", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-applemint-internal-secret": secret,
		},
		body: JSON.stringify(body),
	}) as NextRequest;
}

describe("POST /api/media/imgur/enrich", () => {
	beforeEach(() => {
		vi.stubEnv("CRAWL_INTERNAL_SECRET", INTERNAL_SECRET);
		vi.stubEnv("IMGUR_CLIENT_ID", "fixture-client-id");
		createServiceRoleClientMock.mockReset();
		createServiceRoleClientMock.mockReturnValue({ kind: "service-role-client" });
		runImgurEnrichmentWorkerMock.mockReset();
		runImgurEnrichmentWorkerMock.mockResolvedValue(createMediaWorkerResult());
	});

	afterEach(() => vi.unstubAllEnvs());

	it("constant-time helper 계약으로 잘못된 internal secret을 거부한다", async () => {
		const response = await POST(request("wrong-secret"));

		expect(response.status).toBe(401);
		expect(createServiceRoleClientMock).not.toHaveBeenCalled();
		expect(runImgurEnrichmentWorkerMock).not.toHaveBeenCalled();
	});

	it("IMGUR_CLIENT_ID가 없거나 비어 있으면 503이며 queue를 claim하지 않는다", async () => {
		vi.stubEnv("IMGUR_CLIENT_ID", " ");

		const response = await POST(request());

		expect(response.status).toBe(503);
		expect(createServiceRoleClientMock).not.toHaveBeenCalled();
		expect(runImgurEnrichmentWorkerMock).not.toHaveBeenCalled();
	});

	it("검증된 요청만 service-role worker에 제한된 batch 크기로 전달한다", async () => {
		const response = await POST(request(INTERNAL_SECRET, { limit: 4 }));

		expect(response.status).toBe(200);
		expect(runImgurEnrichmentWorkerMock).toHaveBeenCalledWith(
			createServiceRoleClientMock.mock.results[0].value,
			{ clientId: "fixture-client-id", limit: 4 }
		);
	});

	it("잘못된 limit과 service-role 설정 오류를 fail closed한다", async () => {
		expect((await POST(request(INTERNAL_SECRET, { limit: 5 }))).status).toBe(400);
		expect(createServiceRoleClientMock).not.toHaveBeenCalled();

		createServiceRoleClientMock.mockImplementationOnce(() => {
			throw new Error("missing service role");
		});
		const response = await POST(request());
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ reason: "configuration-missing" });
	});

	it("빈 객체에는 기본 batch를 적용하고 잘못된 JSON·추가 필드를 실행 전에 거부한다", async () => {
		const defaultResponse = await POST(request());
		expect(defaultResponse.status).toBe(200);
		expect(runImgurEnrichmentWorkerMock).toHaveBeenLastCalledWith(expect.anything(), {
			clientId: "fixture-client-id",
			limit: 4,
		});

		runImgurEnrichmentWorkerMock.mockClear();
		const malformed = new Request("http://localhost/api/media/imgur/enrich", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-applemint-internal-secret": INTERNAL_SECRET,
			},
			body: "{",
		}) as NextRequest;
		expect((await POST(malformed)).status).toBe(400);
		expect((await POST(request(INTERNAL_SECRET, { limit: 1, extra: true }))).status).toBe(400);
		for (const limit of [0, -1, 1.5, "1"]) {
			expect((await POST(request(INTERNAL_SECRET, { limit }))).status).toBe(400);
		}
		expect(runImgurEnrichmentWorkerMock).not.toHaveBeenCalled();
	});

	it("internal secret 검증을 body 파싱보다 먼저 수행한다", async () => {
		const malformed = new Request("http://localhost/api/media/imgur/enrich", {
			method: "POST",
			headers: { "x-applemint-internal-secret": "wrong-secret" },
			body: "{",
		}) as NextRequest;

		expect((await POST(malformed)).status).toBe(401);
		expect(runImgurEnrichmentWorkerMock).not.toHaveBeenCalled();
	});
});

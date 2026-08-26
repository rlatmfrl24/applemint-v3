import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { CrawlExecutionResult } from "./contracts";
import { CrawlPipelineError, executeCrawlPipeline } from "./pipeline";

function createExecutionResult(
	overrides: Partial<CrawlExecutionResult> = {}
): CrawlExecutionResult {
	return {
		items: [
			{
				url: "https://example.com/1",
				title: "one",
				description: null,
				host: "example.com",
			},
		],
		attempted: 1,
		succeeded: 1,
		failures: [],
		warnings: [],
		parserObservations: [],
		retryCount: 0,
		recoveredCount: 0,
		parserValidCount: 1,
		parserMinimumCount: 1,
		...overrides,
	};
}

function createRejectedAdmission(reason: "disabled" | "cooldown" | "source-busy" | "capacity") {
	switch (reason) {
		case "cooldown":
			return {
				acquired: false,
				reason,
				nextEligibleAt: "2026-07-22T06:00:00+00:00",
			};
		case "capacity":
			return { acquired: false, reason, activeCount: 2, retryAfterSeconds: 30 };
		case "disabled":
			return { acquired: false, reason };
		case "source-busy":
			return { acquired: false, activeRunId: "41", reason };
	}
}

function createSupabaseMock({
	lockAcquired = true,
	finishError = false,
	admissionReason = "source-busy",
	heartbeatRenewed = true,
	filterKeywords = [{ value: "example.com", method: "source" }],
	invalidStartResponse = false,
	invalidHistoryResponse = false,
	invalidIngestResponse = false,
	invalidFinishResponse = false,
	recoveryError = false,
}: {
	lockAcquired?: boolean;
	finishError?: boolean;
	admissionReason?: "disabled" | "cooldown" | "source-busy" | "capacity";
	heartbeatRenewed?: boolean;
	filterKeywords?: { value: string; method: string }[];
	invalidStartResponse?: boolean;
	invalidHistoryResponse?: boolean;
	invalidIngestResponse?: boolean;
	invalidFinishResponse?: boolean;
	recoveryError?: boolean;
} = {}) {
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This test double models every pipeline RPC response in one auditable boundary.
	const rpc = vi.fn(async (name: string, parameters: Record<string, unknown>) => {
		switch (name) {
			case "begin_crawl_run":
			case "begin_scheduled_crawl_run": {
				const rejected = createRejectedAdmission(admissionReason);
				return {
					data: invalidStartResponse
						? { acquired: true, runId: "42" }
						: lockAcquired
							? {
									acquired: true,
									runId: "42",
									lockKey: "crawl:arcalive",
									runBudgetSeconds: 45,
									lockTtlSeconds: 60,
									heartbeatIntervalSeconds: 15,
								}
							: rejected,
					error: null,
				};
			}
			case "heartbeat_crawl_run":
				return {
					data: heartbeatRenewed
						? { renewed: true, staleAfter: "2026-07-22T06:00:00+00:00" }
						: { renewed: false, reason: "lease-lost" },
					error: null,
				};
			case "ingest_crawl_items":
				return {
					data: invalidIngestResponse ? { skippedCount: 0 } : { insertedCount: 1, skippedCount: 0 },
					error: null,
				};
			case "finish_crawl_run": {
				const result = parameters.p_result as { status: unknown };
				return finishError
					? { data: null, error: { message: "finish failed" } }
					: {
							data: invalidFinishResponse
								? { runId: "42", status: result.status }
								: { runId: "42", status: result.status, durationMs: 123 },
							error: null,
						};
			}
			case "record_crawl_run_contract_failure":
				return recoveryError
					? { data: null, error: { message: "recovery failed" } }
					: { data: true, error: null };
			case "release_crawl_lock":
				return { data: true, error: null };
			default:
				throw new Error(`Unexpected RPC: ${name} ${JSON.stringify(parameters)}`);
		}
	});
	const from = vi.fn((table: string) => {
		if (table === "filter-keyword") {
			return {
				select: vi.fn().mockResolvedValue({
					data: filterKeywords,
					error: null,
				}),
			};
		}
		if (table === "crawl-history") {
			return {
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						in: vi.fn().mockResolvedValue({
							data: invalidHistoryResponse ? [{ url: null }] : [],
							error: null,
						}),
					})),
				})),
			};
		}
		throw new Error(`Unexpected table: ${table}`);
	});

	return {
		client: { rpc, from } as unknown as SupabaseClient,
		rpc,
	};
}

describe("executeCrawlPipeline", () => {
	it("크롤링부터 원자적 적재와 실행 이력 종료까지 한 경로에서 처리한다", async () => {
		const { client, rpc } = createSupabaseMock();
		const runCrawler = vi.fn().mockResolvedValue(createExecutionResult());

		await expect(
			executeCrawlPipeline("arcalive", client, runCrawler, { requestId: "request-1" })
		).resolves.toEqual({
			runId: "42",
			status: "succeeded",
			target: "arcalive",
			insertedCount: 1,
			skippedCount: 0,
			warningCount: 0,
			durationMs: 123,
		});
		expect(runCrawler).toHaveBeenCalledWith(
			"arcalive",
			expect.objectContaining({ requestId: "request-1", runId: "42" })
		);
		expect(rpc).toHaveBeenCalledWith(
			"ingest_crawl_items",
			expect.objectContaining({
				p_crawl_source: "arcalive",
				p_items: [expect.objectContaining({ type: "source" })],
			})
		);
		expect(rpc).toHaveBeenCalledWith(
			"finish_crawl_run",
			expect.objectContaining({
				p_result: expect.objectContaining({ status: "succeeded", insertedCount: 1 }),
			})
		);
	});

	it("ignore를 유지하면서 공급자 타입을 keyword보다 우선해 ingest한다", async () => {
		const { client, rpc } = createSupabaseMock({
			filterKeywords: [
				{ value: "youtube.com", method: "source" },
				{ value: "ignored.example", method: "ignore" },
			],
		});
		const runCrawler = vi.fn().mockResolvedValue(
			createExecutionResult({
				items: [
					{
						url: "https://www.youtube.com/watch?v=video",
						title: "video",
						description: null,
						host: "youtube.com",
					},
					{
						url: "https://ignored.example/post",
						title: "ignored",
						description: null,
						host: "ignored.example",
					},
				],
			})
		);

		await executeCrawlPipeline("arcalive", client, runCrawler);

		expect(rpc).toHaveBeenCalledWith(
			"ingest_crawl_items",
			expect.objectContaining({
				p_items: [
					expect.objectContaining({
						url: "https://www.youtube.com/watch?v=video",
						type: "youtube",
					}),
				],
			})
		);
	});

	it("외부 media API 오류와 무관하게 크롤링 run을 분류·적재 결과로 종료한다", async () => {
		const mediaApiFetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("fixture media API failure"));
		const { client, rpc } = createSupabaseMock();
		const runCrawler = vi.fn().mockResolvedValue(
			createExecutionResult({
				items: [
					{
						url: "https://www.youtube.com/watch?v=abcDEF12345",
						title: "source title",
						description: null,
						host: "youtube.com",
					},
					{
						url: "https://imgur.com/a/Album12",
						title: "source album title",
						description: null,
						host: "imgur.com",
					},
				],
			})
		);

		await expect(executeCrawlPipeline("arcalive", client, runCrawler)).resolves.toMatchObject({
			status: "succeeded",
			insertedCount: 1,
		});
		expect(mediaApiFetch).not.toHaveBeenCalled();
		expect(rpc).toHaveBeenCalledWith(
			"ingest_crawl_items",
			expect.objectContaining({
				p_items: expect.arrayContaining([
					expect.objectContaining({ type: "youtube" }),
					expect.objectContaining({ type: "imgur" }),
				]),
			})
		);
		expect(rpc).toHaveBeenCalledWith(
			"finish_crawl_run",
			expect.objectContaining({
				p_result: expect.objectContaining({ status: "succeeded" }),
			})
		);
	});

	it("정보성 parser 진단은 성공 상태와 경고 수를 오염시키지 않는다", async () => {
		const { client, rpc } = createSupabaseMock();
		const runCrawler = vi.fn().mockResolvedValue(
			createExecutionResult({
				warnings: [
					{
						url: "https://example.com",
						code: "discarded-items",
						severity: "info",
						message: "ignored",
						count: 3,
						attempt: 1,
					},
				],
			})
		);

		await expect(executeCrawlPipeline("arcalive", client, runCrawler)).resolves.toMatchObject({
			status: "succeeded",
			warningCount: 0,
		});
		expect(rpc).toHaveBeenCalledWith(
			"finish_crawl_run",
			expect.objectContaining({
				p_result: expect.objectContaining({ status: "succeeded", warningCount: 0 }),
			})
		);
	});

	it("global lock을 얻지 못하면 실행하지 않고 409와 activeRunId를 반환한다", async () => {
		const { client } = createSupabaseMock({ lockAcquired: false });
		const runCrawler = vi.fn();

		const error = await executeCrawlPipeline("arcalive", client, runCrawler).catch(
			(result: unknown) => result
		);

		expect(error).toBeInstanceOf(CrawlPipelineError);
		expect(error).toMatchObject({ httpStatus: 409, activeRunId: "41" });
		expect(runCrawler).not.toHaveBeenCalled();
	});

	it("예약 실행의 cooldown 판정을 구조화된 admission 오류로 전달한다", async () => {
		const { client, rpc } = createSupabaseMock({
			lockAcquired: false,
			admissionReason: "cooldown",
		});

		const error = await executeCrawlPipeline("arcalive", client, vi.fn(), {
			trigger: "scheduled",
		}).catch((result: unknown) => result);

		expect(error).toMatchObject({ httpStatus: 409, admissionReason: "cooldown" });
		expect(rpc).toHaveBeenCalledWith(
			"begin_scheduled_crawl_run",
			expect.objectContaining({ p_source: "arcalive" })
		);
	});

	it("실행 예산이 끝나면 source 작업을 중단하고 504로 종료한다", async () => {
		vi.useFakeTimers();
		const { client, rpc } = createSupabaseMock();
		const runCrawler = vi.fn(
			(_target, options?: { signal?: AbortSignal }) =>
				new Promise<CrawlExecutionResult>((_resolve, reject) => {
					options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
						once: true,
					});
				})
		);

		const execution = executeCrawlPipeline("arcalive", client, runCrawler).catch(
			(result: unknown) => result
		);
		await vi.advanceTimersByTimeAsync(45_000);
		const error = await execution;

		expect(error).toMatchObject({ httpStatus: 504, runId: "42" });
		expect(rpc).toHaveBeenCalledWith("heartbeat_crawl_run", expect.anything());
		vi.useRealTimers();
	});

	it("heartbeat가 lease 상실을 반환하면 실행을 즉시 중단한다", async () => {
		vi.useFakeTimers();
		const { client, rpc } = createSupabaseMock({ heartbeatRenewed: false });
		const runCrawler = vi.fn(
			(_target, options?: { signal?: AbortSignal }) =>
				new Promise<CrawlExecutionResult>((_resolve, reject) => {
					options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
						once: true,
					});
				})
		);

		const execution = executeCrawlPipeline("arcalive", client, runCrawler).catch(
			(result: unknown) => result
		);
		await vi.advanceTimersByTimeAsync(15_000);
		const error = await execution;

		expect(error).toMatchObject({ httpStatus: 500, runId: "42" });
		expect(rpc).toHaveBeenCalledWith("heartbeat_crawl_run", expect.anything());
		vi.useRealTimers();
	});

	it("모든 소스가 timeout이면 실패 이력을 종료하고 504를 반환한다", async () => {
		const { client, rpc } = createSupabaseMock();
		const runCrawler = vi.fn().mockResolvedValue(
			createExecutionResult({
				items: [],
				succeeded: 0,
				failures: [
					{
						url: "https://example.com",
						message: "timeout",
						kind: "network",
						timeout: true,
						attempt: 1,
					},
				],
			})
		);

		const error = await executeCrawlPipeline("arcalive", client, runCrawler).catch(
			(result: unknown) => result
		);

		expect(error).toMatchObject({ httpStatus: 504, stage: "source", runId: "42" });
		expect(rpc).toHaveBeenCalledWith(
			"finish_crawl_run",
			expect.objectContaining({
				p_result: expect.objectContaining({ status: "failed", timeoutFailureCount: 1 }),
			})
		);
		expect(rpc).not.toHaveBeenCalledWith("release_crawl_lock", expect.anything());
	});

	it("start RPC의 필수 필드가 누락되면 source를 호출하지 않고 계약 오류로 실패한다", async () => {
		const { client } = createSupabaseMock({ invalidStartResponse: true });
		const runCrawler = vi.fn();

		await expect(executeCrawlPipeline("arcalive", client, runCrawler)).rejects.toMatchObject({
			httpStatus: 500,
			stage: "unknown",
		});
		expect(runCrawler).not.toHaveBeenCalled();
	});

	it("history 응답이 잘못되면 안전한 단계와 메시지를 실행 이력에 남긴다", async () => {
		const { client, rpc } = createSupabaseMock({ invalidHistoryResponse: true });

		await expect(
			executeCrawlPipeline("arcalive", client, vi.fn().mockResolvedValue(createExecutionResult()))
		).rejects.toMatchObject({ stage: "history", runId: "42" });
		expect(rpc).toHaveBeenCalledWith(
			"finish_crawl_run",
			expect.objectContaining({
				p_result: expect.objectContaining({
					errorStage: "history",
					errorMessage: "수집 이력 확인에 실패했습니다.",
				}),
			})
		);
	});

	it("ingest count 누락을 0으로 대체하지 않고 안전한 실패로 종료한다", async () => {
		const { client, rpc } = createSupabaseMock({ invalidIngestResponse: true });

		await expect(
			executeCrawlPipeline("arcalive", client, vi.fn().mockResolvedValue(createExecutionResult()))
		).rejects.toMatchObject({ stage: "ingest", runId: "42" });
		expect(rpc).toHaveBeenCalledWith(
			"finish_crawl_run",
			expect.objectContaining({
				p_result: expect.objectContaining({
					errorStage: "ingest",
					errorMessage: "수집 항목 저장에 실패했습니다.",
				}),
			})
		);
	});

	it("finish 응답 필드가 누락되면 recovery RPC로 권위 실행 이력을 실패 처리한다", async () => {
		const { client, rpc } = createSupabaseMock({ invalidFinishResponse: true });

		await expect(
			executeCrawlPipeline("arcalive", client, vi.fn().mockResolvedValue(createExecutionResult()))
		).rejects.toMatchObject({ stage: "unknown", runId: "42" });
		expect(rpc).toHaveBeenCalledWith(
			"record_crawl_run_contract_failure",
			expect.objectContaining({
				p_run_id: "42",
				p_error_stage: "unknown",
				p_error_message: "크롤링 실행 계약 처리에 실패했습니다.",
			})
		);
		expect(rpc).not.toHaveBeenCalledWith("release_crawl_lock", expect.anything());
	});

	it("실행 이력 종료가 실패하면 lock fallback을 수행한다", async () => {
		const { client, rpc } = createSupabaseMock({ finishError: true, recoveryError: true });

		await expect(
			executeCrawlPipeline("arcalive", client, vi.fn().mockResolvedValue(createExecutionResult()))
		).rejects.toMatchObject({ httpStatus: 500, stage: "unknown", runId: "42" });
		expect(rpc).toHaveBeenCalledWith(
			"release_crawl_lock",
			expect.objectContaining({ p_lock_key: "crawl:arcalive" })
		);
	});
});

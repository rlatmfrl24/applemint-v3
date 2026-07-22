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

function createSupabaseMock({
	lockAcquired = true,
	finishError = false,
	admissionReason = "source-busy",
	heartbeatRenewed = true,
}: {
	lockAcquired?: boolean;
	finishError?: boolean;
	admissionReason?: "disabled" | "cooldown" | "source-busy" | "capacity";
	heartbeatRenewed?: boolean;
} = {}) {
	const rpc = vi.fn(async (name: string, parameters: Record<string, unknown>) => {
		switch (name) {
			case "begin_crawl_run":
			case "begin_scheduled_crawl_run":
				return {
					data: lockAcquired
						? {
								acquired: true,
								runId: "42",
								lockKey: "crawl:arcalive",
								runBudgetSeconds: 45,
								heartbeatIntervalSeconds: 15,
							}
						: { acquired: false, activeRunId: "41", reason: admissionReason },
					error: null,
				};
			case "heartbeat_crawl_run":
				return { data: { renewed: heartbeatRenewed }, error: null };
			case "ingest_crawl_items":
				return { data: { insertedCount: 1, skippedCount: 0 }, error: null };
			case "finish_crawl_run":
				return finishError
					? { data: null, error: { message: "finish failed" } }
					: { data: { durationMs: 123 }, error: null };
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
					data: [{ value: "example.com", method: "source" }],
					error: null,
				}),
			};
		}
		if (table === "crawl-history") {
			return {
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						in: vi.fn().mockResolvedValue({ data: [], error: null }),
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

		await expect(executeCrawlPipeline("arcalive", client, runCrawler)).resolves.toEqual({
			runId: "42",
			status: "succeeded",
			target: "arcalive",
			insertedCount: 1,
			skippedCount: 0,
			warningCount: 0,
			durationMs: 123,
		});
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

	it("실행 이력 종료가 실패하면 lock fallback을 수행한다", async () => {
		const { client, rpc } = createSupabaseMock({ finishError: true });

		await expect(
			executeCrawlPipeline("arcalive", client, vi.fn().mockResolvedValue(createExecutionResult()))
		).rejects.toMatchObject({ httpStatus: 500, stage: "unknown", runId: "42" });
		expect(rpc).toHaveBeenCalledWith(
			"release_crawl_lock",
			expect.objectContaining({ p_lock_key: "crawl:arcalive" })
		);
	});
});

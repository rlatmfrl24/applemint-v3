import { type NextRequest, NextResponse } from "next/server";
import { crawlArcalive } from "../arcalive";
import { crawlArcalivePuppeteer } from "../arcalive-puppeteer";

export const dynamic = "force-dynamic";

interface CrawlerResult {
	success: boolean;
	data?: any[];
	duration: number;
	itemCount: number;
	error?: string;
	memoryUsage?: any;
}

// 메모리 사용량 측정 함수
function getMemoryUsage() {
	if (typeof process !== "undefined" && process.memoryUsage) {
		const usage = process.memoryUsage();
		return {
			rss: Math.round(usage.rss / 1024 / 1024),
			heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
		};
	}
	return null;
}

// 기존 크롤러 테스트
async function testOriginalCrawler(): Promise<CrawlerResult> {
	const startTime = Date.now();
	const initialMemory = getMemoryUsage();

	try {
		console.log("[Compare API] 기존 크롤러 테스트 시작");
		const result = await crawlArcalive();
		const endTime = Date.now();
		const finalMemory = getMemoryUsage();

		console.log(
			`[Compare API] 기존 크롤러 완료: ${result.length}개 아이템, ${(
				(endTime - startTime) / 1000
			).toFixed(2)}초`
		);

		return {
			success: true,
			data: result,
			duration: endTime - startTime,
			itemCount: result.length,
			memoryUsage: {
				initial: initialMemory,
				final: finalMemory,
			},
		};
	} catch (error) {
		const endTime = Date.now();
		const finalMemory = getMemoryUsage();

		console.error(
			"[Compare API] 기존 크롤러 실패:",
			error instanceof Error ? error.message : "Unknown error"
		);

		return {
			success: false,
			duration: endTime - startTime,
			itemCount: 0,
			error: error instanceof Error ? error.message : "Unknown error",
			memoryUsage: {
				initial: initialMemory,
				final: finalMemory,
			},
		};
	}
}

// Puppeteer 크롤러 테스트
async function testPuppeteerCrawler(): Promise<CrawlerResult> {
	const startTime = Date.now();
	const initialMemory = getMemoryUsage();

	try {
		console.log("[Compare API] Puppeteer 크롤러 테스트 시작");
		const result = await crawlArcalivePuppeteer();
		const endTime = Date.now();
		const finalMemory = getMemoryUsage();

		console.log(
			`[Compare API] Puppeteer 크롤러 완료: ${result.length}개 아이템, ${(
				(endTime - startTime) / 1000
			).toFixed(2)}초`
		);

		return {
			success: true,
			data: result,
			duration: endTime - startTime,
			itemCount: result.length,
			memoryUsage: {
				initial: initialMemory,
				final: finalMemory,
			},
		};
	} catch (error) {
		const endTime = Date.now();
		const finalMemory = getMemoryUsage();

		console.error(
			"[Compare API] Puppeteer 크롤러 실패:",
			error instanceof Error ? error.message : "Unknown error"
		);

		return {
			success: false,
			duration: endTime - startTime,
			itemCount: 0,
			error: error instanceof Error ? error.message : "Unknown error",
			memoryUsage: {
				initial: initialMemory,
				final: finalMemory,
			},
		};
	}
}

export async function GET(request: NextRequest) {
	const { searchParams } = new URL(request.url);
	const mode = searchParams.get("mode") || "both"; // 'original', 'puppeteer', 'both'

	const totalStartTime = Date.now();
	console.log("[Compare API] =".repeat(40));
	console.log("[Compare API] 크롤러 비교 테스트 시작");
	console.log("[Compare API] 테스트 모드:", mode);
	console.log("[Compare API] 시작 시간:", new Date().toISOString());

	try {
		let originalResult: CrawlerResult | null = null;
		let puppeteerResult: CrawlerResult | null = null;

		// 테스트 실행
		if (mode === "original" || mode === "both") {
			originalResult = await testOriginalCrawler();
		}

		if (mode === "puppeteer" || mode === "both") {
			puppeteerResult = await testPuppeteerCrawler();
		}

		const totalEndTime = Date.now();
		const totalDuration = totalEndTime - totalStartTime;

		// 비교 분석
		const comparison: any = {
			testMode: mode,
			totalDuration: totalDuration,
			totalDurationInSeconds: Number((totalDuration / 1000).toFixed(2)),
			testTime: {
				start: new Date(totalStartTime).toISOString(),
				end: new Date(totalEndTime).toISOString(),
			},
			environment: process.env.NODE_ENV,
			vercelEnv: process.env.VERCEL_ENV,
		};

		if (originalResult) {
			comparison.original = {
				success: originalResult.success,
				itemCount: originalResult.itemCount,
				duration: originalResult.duration,
				durationInSeconds: Number((originalResult.duration / 1000).toFixed(2)),
				error: originalResult.error,
				memoryUsage: originalResult.memoryUsage,
				itemsPerSecond:
					originalResult.itemCount > 0
						? Number((originalResult.itemCount / (originalResult.duration / 1000)).toFixed(2))
						: 0,
			};
		}

		if (puppeteerResult) {
			comparison.puppeteer = {
				success: puppeteerResult.success,
				itemCount: puppeteerResult.itemCount,
				duration: puppeteerResult.duration,
				durationInSeconds: Number((puppeteerResult.duration / 1000).toFixed(2)),
				error: puppeteerResult.error,
				memoryUsage: puppeteerResult.memoryUsage,
				itemsPerSecond:
					puppeteerResult.itemCount > 0
						? Number((puppeteerResult.itemCount / (puppeteerResult.duration / 1000)).toFixed(2))
						: 0,
			};
		}

		// 성능 비교 (둘 다 성공한 경우)
		if (originalResult?.success && puppeteerResult?.success) {
			comparison.performance = {
				speedRatio: Number((puppeteerResult.duration / originalResult.duration).toFixed(2)), // Puppeteer가 얼마나 더 느린지
				itemCountDifference: puppeteerResult.itemCount - originalResult.itemCount,
				betterCrawler:
					puppeteerResult.itemCount > originalResult.itemCount
						? "puppeteer"
						: puppeteerResult.itemCount < originalResult.itemCount
							? "original"
							: "equal",
			};
		}

		// 로그 출력
		console.log("[Compare API] =".repeat(40));
		console.log("[Compare API] 비교 테스트 완료!");
		console.log(`[Compare API] 총 소요시간: ${comparison.totalDurationInSeconds}초`);

		if (originalResult) {
			console.log(
				`[Compare API] 기존 크롤러: ${
					originalResult.success ? "성공" : "실패"
				} - ${originalResult.itemCount}개, ${(originalResult.duration / 1000).toFixed(2)}초`
			);
		}

		if (puppeteerResult) {
			console.log(
				`[Compare API] Puppeteer 크롤러: ${
					puppeteerResult.success ? "성공" : "실패"
				} - ${puppeteerResult.itemCount}개, ${(puppeteerResult.duration / 1000).toFixed(2)}초`
			);
		}

		if (comparison.performance) {
			console.log(
				`[Compare API] 성능 비교: Puppeteer가 ${comparison.performance.speedRatio}배 ${
					comparison.performance.speedRatio > 1 ? "느림" : "빠름"
				}`
			);
			console.log(`[Compare API] 아이템 수 차이: ${comparison.performance.itemCountDifference}개`);
		}

		console.log("[Compare API] =".repeat(40));

		// 응답 데이터 구성
		const responseData: any = {
			success: true,
			comparison: comparison,
			message: "크롤러 비교 테스트가 완료되었습니다.",
		};

		// 실제 데이터 포함 (샘플만)
		if (originalResult?.success && originalResult.data) {
			responseData.samples = responseData.samples || {};
			responseData.samples.original = originalResult.data.slice(0, 3);
		}

		if (puppeteerResult?.success && puppeteerResult.data) {
			responseData.samples = responseData.samples || {};
			responseData.samples.puppeteer = puppeteerResult.data.slice(0, 3);
		}

		return NextResponse.json(responseData, {
			status: 200,
			headers: {
				"Cache-Control": "no-cache, no-store, must-revalidate",
				Pragma: "no-cache",
				Expires: "0",
			},
		});
	} catch (error) {
		const totalEndTime = Date.now();
		const totalDuration = totalEndTime - totalStartTime;

		console.error("[Compare API] =".repeat(40));
		console.error("[Compare API] 비교 테스트 중 에러 발생!");
		console.error("[Compare API] 에러:", error instanceof Error ? error.message : "Unknown error");
		console.error(`[Compare API] 실패까지 소요 시간: ${(totalDuration / 1000).toFixed(2)}초`);
		console.error("[Compare API] =".repeat(40));

		return NextResponse.json(
			{
				success: false,
				error: {
					message: error instanceof Error ? error.message : "알 수 없는 에러가 발생했습니다.",
					type: error instanceof Error ? error.constructor.name : "UnknownError",
				},
				duration: totalDuration,
				durationInSeconds: Number((totalDuration / 1000).toFixed(2)),
				message: "크롤러 비교 테스트 중 에러가 발생했습니다.",
			},
			{
				status: 500,
				headers: {
					"Cache-Control": "no-cache, no-store, must-revalidate",
					Pragma: "no-cache",
					Expires: "0",
				},
			}
		);
	}
}

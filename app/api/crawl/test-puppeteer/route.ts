import { type NextRequest, NextResponse } from "next/server";
import { crawlArcalivePuppeteer } from "../arcalive-puppeteer";

// 강제 다이나믹 설정 (서버리스 함수에서 실행)
export const dynamic = "force-dynamic";

// 메모리 사용량 측정 함수
function getMemoryUsage() {
	if (typeof process !== "undefined" && process.memoryUsage) {
		const usage = process.memoryUsage();
		return {
			rss: Math.round(usage.rss / 1024 / 1024), // MB
			heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
			heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
			external: Math.round(usage.external / 1024 / 1024), // MB
		};
	}
	return null;
}

export async function GET(request: NextRequest) {
	const startTime = Date.now();
	const initialMemory = getMemoryUsage();

	console.log("[Test Puppeteer API] =".repeat(30));
	console.log("[Test Puppeteer API] 크롤링 테스트 시작");
	console.log("[Test Puppeteer API] 시작 시간:", new Date().toISOString());
	console.log("[Test Puppeteer API] 초기 메모리 사용량:", initialMemory);
	console.log("[Test Puppeteer API] 환경:", process.env.NODE_ENV);
	console.log("[Test Puppeteer API] Vercel 환경:", process.env.VERCEL_ENV);

	try {
		// puppeteer 크롤링 실행
		const result = await crawlArcalivePuppeteer();

		const endTime = Date.now();
		const duration = endTime - startTime;
		const finalMemory = getMemoryUsage();

		// 성능 통계 계산
		const stats = {
			totalItems: result.length,
			duration: duration,
			durationInSeconds: Number((duration / 1000).toFixed(2)),
			itemsPerSecond: Number((result.length / (duration / 1000)).toFixed(2)),
			averageTimePerItem: Number((duration / result.length).toFixed(2)),
			startTime: new Date(startTime).toISOString(),
			endTime: new Date(endTime).toISOString(),
			environment: process.env.NODE_ENV,
			vercelEnv: process.env.VERCEL_ENV,
			memoryUsage: {
				initial: initialMemory,
				final: finalMemory,
				increase:
					finalMemory && initialMemory
						? {
								rss: finalMemory.rss - initialMemory.rss,
								heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
							}
						: null,
			},
		};

		// 성능 로그 출력
		console.log("[Test Puppeteer API] =".repeat(30));
		console.log("[Test Puppeteer API] 크롤링 완료!");
		console.log(`[Test Puppeteer API] 수집된 아이템 수: ${result.length}개`);
		console.log(`[Test Puppeteer API] 총 소요시간: ${stats.durationInSeconds}초`);
		console.log(`[Test Puppeteer API] 초당 처리 아이템: ${stats.itemsPerSecond}개/초`);
		console.log(`[Test Puppeteer API] 아이템당 평균 시간: ${stats.averageTimePerItem}ms`);
		console.log("[Test Puppeteer API] 최종 메모리 사용량:", finalMemory);
		if (stats.memoryUsage.increase) {
			console.log("[Test Puppeteer API] 메모리 증가량:", stats.memoryUsage.increase);
		}

		// 수집된 아이템들의 샘플 로그 (첫 3개만)
		const sampleItems = result.slice(0, 3);
		console.log("[Test Puppeteer API] 샘플 아이템들:");
		sampleItems.forEach((item, index) => {
			console.log(`[Test Puppeteer API] ${index + 1}. ${item.title}`);
			console.log(`[Test Puppeteer API]    URL: ${item.url}`);
			console.log(`[Test Puppeteer API]    태그: ${item.tag.join(", ")}`);
		});

		console.log("[Test Puppeteer API] =".repeat(30));

		// 성공 응답
		return NextResponse.json(
			{
				success: true,
				data: result,
				stats: stats,
				message: "Puppeteer 크롤링이 성공적으로 완료되었습니다.",
				sampleItems: sampleItems,
			},
			{
				status: 200,
				headers: {
					"Cache-Control": "no-cache, no-store, must-revalidate",
					Pragma: "no-cache",
					Expires: "0",
				},
			}
		);
	} catch (error) {
		const endTime = Date.now();
		const duration = endTime - startTime;
		const finalMemory = getMemoryUsage();

		// 에러 로그
		console.error("[Test Puppeteer API] =".repeat(30));
		console.error("[Test Puppeteer API] 크롤링 중 에러 발생!");
		console.error(
			"[Test Puppeteer API] 에러 메시지:",
			error instanceof Error ? error.message : "알 수 없는 에러"
		);
		console.error(
			"[Test Puppeteer API] 에러 스택:",
			error instanceof Error ? error.stack : "Stack not available"
		);
		console.error("[Test Puppeteer API] 실패 시점:", new Date().toISOString());
		console.error(`[Test Puppeteer API] 실패까지 소요 시간: ${(duration / 1000).toFixed(2)}초`);
		console.error("[Test Puppeteer API] 최종 메모리 사용량:", finalMemory);
		console.error("[Test Puppeteer API] =".repeat(30));

		// 에러 응답
		return NextResponse.json(
			{
				success: false,
				error: {
					message: error instanceof Error ? error.message : "알 수 없는 에러가 발생했습니다.",
					stack: error instanceof Error ? error.stack : null,
					type: error instanceof Error ? error.constructor.name : "UnknownError",
				},
				stats: {
					duration: duration,
					durationInSeconds: Number((duration / 1000).toFixed(2)),
					failedAt: new Date().toISOString(),
					environment: process.env.NODE_ENV,
					vercelEnv: process.env.VERCEL_ENV,
					memoryUsage: {
						initial: initialMemory,
						final: finalMemory,
					},
				},
				message: "Puppeteer 크롤링 중 에러가 발생했습니다.",
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

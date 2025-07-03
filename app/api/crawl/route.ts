import type { NextRequest } from "next/server";
import { crawlArcalive } from "./arcalive";
import { crawlBattlepage } from "./battlepage";
import { crawlInsagirl } from "./insagirl";
import { crawlIssuelink } from "./issuelink";
import type { CrawlItemType } from "@/lib/typeDefs";

// 재시도 함수
async function retryOperation<T>(
	operation: () => Promise<T>,
	maxRetries = 3,
	delayMs = 1000,
): Promise<T> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			const result = await operation();
			return result;
		} catch (error) {
			console.error(`[Retry] 시도 ${attempt}/${maxRetries} 실패:`, error);

			if (attempt === maxRetries) {
				throw error; // 마지막 시도에서도 실패하면 에러 던지기
			}

			// 지수 백오프 적용
			const delay = delayMs * 2 ** (attempt - 1);
			console.log(`[Retry] ${delay}ms 대기 후 재시도...`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw new Error("Retry logic error"); // 여기에 도달하면 안됨
}

export async function GET(request: NextRequest) {
	const startTime = Date.now();
	const queries = request.nextUrl.searchParams;
	const target = queries.get("target");

	console.log(
		`[Crawl API] 크롤링 요청 시작 - 타겟: ${target || "undefined"}`,
	);
	console.log(`[Crawl API] 요청 URL: ${request.url}`);
	console.log(`[Crawl API] 시작 시간: ${new Date(startTime).toISOString()}`);

	if (!target) {
		console.error("[Crawl API] 에러: 타겟이 제공되지 않음");
		return new Response("No target provided", {
			status: 400,
		});
	}

	try {
		let result: CrawlItemType[];
		let crawlFunction: string;

		switch (target) {
			case "insagirl":
				console.log("[Crawl API] 인사걸 크롤링 시작");
				crawlFunction = "insagirl";
				result = await retryOperation(() => crawlInsagirl(), 2, 1000);
				break;
			case "battlepage":
				console.log("[Crawl API] 배틀페이지 크롤링 시작");
				crawlFunction = "battlepage";
				result = await retryOperation(() => crawlBattlepage(), 2, 2000);
				break;
			case "arcalive":
				console.log("[Crawl API] 아칼라이브 크롤링 시작");
				crawlFunction = "arcalive";
				result = await retryOperation(() => crawlArcalive(), 2, 1500);
				break;
			case "issuelink":
				console.log("[Crawl API] 이슈링크 크롤링 시작");
				crawlFunction = "issuelink";
				result = await retryOperation(() => crawlIssuelink(), 2, 1000);
				break;
			default:
				console.error(`[Crawl API] 에러: 잘못된 타겟 - ${target}`);
				return new Response("Invalid target", {
					status: 400,
				});
		}

		const endTime = Date.now();
		const duration = endTime - startTime;

		console.log(`[Crawl API] ${crawlFunction} 크롤링 완료`);
		console.log(`[Crawl API] 결과 아이템 개수: ${result?.length || 0}`);
		console.log(`[Crawl API] 처리 시간: ${duration}ms`);
		console.log(
			`[Crawl API] 종료 시간: ${new Date(endTime).toISOString()}`,
		);

		// 결과 로그 (처음 3개 아이템만)
		if (result && result.length > 0) {
			console.log("[Crawl API] 첫 번째 아이템 예시:", {
				url: result[0]?.url,
				title: result[0]?.title,
				host: result[0]?.host,
				tag: result[0]?.tag,
			});

			if (result.length > 1) {
				console.log("[Crawl API] 두 번째 아이템 예시:", {
					url: result[1]?.url,
					title: result[1]?.title,
					host: result[1]?.host,
					tag: result[1]?.tag,
				});
			}

			if (result.length > 2) {
				console.log("[Crawl API] 세 번째 아이템 예시:", {
					url: result[2]?.url,
					title: result[2]?.title,
					host: result[2]?.host,
					tag: result[2]?.tag,
				});
			}
		}

		return new Response(JSON.stringify(result), {
			status: 200,
			headers: {
				"Content-Type": "application/json",
			},
		});
	} catch (error) {
		const endTime = Date.now();
		const duration = endTime - startTime;

		console.error(`[Crawl API] ${target} 크롤링 중 에러 발생:`, error);
		console.error(`[Crawl API] 에러 처리 시간: ${duration}ms`);
		console.error(
			"[Crawl API] 에러 스택:",
			error instanceof Error ? error.stack : "Stack not available",
		);

		return new Response(
			JSON.stringify({
				error: "크롤링 중 에러가 발생했습니다",
				message: error instanceof Error
					? error.message
					: "Unknown error",
				target: target,
				duration: duration,
			}),
			{
				status: 500,
				headers: {
					"Content-Type": "application/json",
				},
			},
		);
	}
}

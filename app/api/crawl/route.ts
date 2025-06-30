import type { NextRequest } from "next/server";
import { crawlInsagirl } from "./insagirl";
import { crawlBattlepage } from "./battlepage";
import { crawlArcalive } from "./arcalive";
import { crawlIssuelink } from "./issuelink";

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const queries = request.nextUrl.searchParams;
  const target = queries.get("target");

  console.log(`[Crawl API] 크롤링 요청 시작 - 타겟: ${target || "undefined"}`);
  console.log(`[Crawl API] 요청 URL: ${request.url}`);
  console.log(`[Crawl API] 시작 시간: ${new Date(startTime).toISOString()}`);

  if (!target) {
    console.error("[Crawl API] 에러: 타겟이 제공되지 않음");
    return new Response("No target provided", {
      status: 400,
    });
  }

  try {
    let result;
    let crawlFunction;

    switch (target) {
      case "insagirl":
        console.log("[Crawl API] 인사걸 크롤링 시작");
        crawlFunction = "insagirl";
        result = await crawlInsagirl();
        break;
      case "battlepage":
        console.log("[Crawl API] 배틀페이지 크롤링 시작");
        crawlFunction = "battlepage";
        result = await crawlBattlepage();
        break;
      case "arcalive":
        console.log("[Crawl API] 아칼라이브 크롤링 시작");
        crawlFunction = "arcalive";
        result = await crawlArcalive();
        break;
      case "issuelink":
        console.log("[Crawl API] 이슈링크 크롤링 시작");
        crawlFunction = "issuelink";
        result = await crawlIssuelink();
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
    console.log(`[Crawl API] 종료 시간: ${new Date(endTime).toISOString()}`);

    // 결과 로그 (처음 3개 아이템만)
    if (result && result.length > 0) {
      console.log(`[Crawl API] 첫 번째 아이템 예시:`, {
        url: result[0]?.url,
        title: result[0]?.title,
        host: result[0]?.host,
        tag: result[0]?.tag,
      });

      if (result.length > 1) {
        console.log(`[Crawl API] 두 번째 아이템 예시:`, {
          url: result[1]?.url,
          title: result[1]?.title,
          host: result[1]?.host,
          tag: result[1]?.tag,
        });
      }

      if (result.length > 2) {
        console.log(`[Crawl API] 세 번째 아이템 예시:`, {
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
      `[Crawl API] 에러 스택:`,
      error instanceof Error ? error.stack : "Stack not available",
    );

    return new Response(
      JSON.stringify({
        error: "크롤링 중 에러가 발생했습니다",
        message: error instanceof Error ? error.message : "Unknown error",
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

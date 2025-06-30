import * as cheerio from "cheerio";
import { Agent, fetch } from "undici";

// 간단한 지연 함수
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function crawlBattlepage() {
  console.log("[Battlepage] 크롤링 시작");

  const baseUrl = "https://v12.battlepage.com";
  const pageSize = 5;
  const targetList: string[] = [];

  //Get Target URL List
  Array.from({ length: pageSize }, (_, i) => {
    targetList.push(`${baseUrl}/??=Board.Humor.Table&page=${i + 1}`);
    targetList.push(`${baseUrl}/??=Board.ETC.Table&page=${i + 1}`);
  });

  console.log(
    `[Battlepage] 크롤링 대상 URL 목록 (총 ${targetList.length}개):`,
    targetList,
  );

  try {
    const detectedList = [];

    // 동시 요청 대신 순차 처리로 변경 (rate limiting 방지)
    for (let index = 0; index < targetList.length; index++) {
      const url = targetList[index];
      console.log(
        `[Battlepage] URL ${
          index + 1
        }/${targetList.length} 크롤링 시작: ${url}`,
      );

      try {
        // 각 요청 사이에 지연 추가
        if (index > 0) {
          const delayMs = 500 + Math.random() * 500; // 500-1000ms 랜덤 지연
          console.log(`[Battlepage] ${delayMs.toFixed(0)}ms 지연 후 요청...`);
          await delay(delayMs);
        }

        const response = await fetch(url, {
          headers: {
            accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          dispatcher: new Agent({
            connect: {
              rejectUnauthorized: false,
            },
          }),
        });

        //request 헤더 출력
        console.log(response.headers);

        console.log(
          `[Battlepage] URL ${index + 1} 응답 상태: ${response.status}`,
        );

        if (!response.ok) {
          throw new Error(
            `HTTP 에러: ${response.status} ${response.statusText}`,
          );
        }

        const text = await response.text();
        console.log(
          `[Battlepage] URL ${index + 1} HTML 길이: ${text.length} 문자`,
        );

        const $ = cheerio.load(text);
        console.log(`[Battlepage] URL ${index + 1} HTML 파싱 완료`);

        const itemList = $(".ListTable div").map((i, el) => {
          const href = $(el).find("a").attr("href");
          const title = $(el).find(".bp_subject").attr("title");

          return {
            url: baseUrl + (href as string).replace(/&page=\d+/, ""),
            title: title,
            description: "",
            host: baseUrl,
            tag: ["battlepage"],
          };
        });

        const items = itemList.get();
        console.log(
          `[Battlepage] URL ${index + 1} 아이템 ${items.length}개 추출 완료`,
        );

        // 추출된 아이템들의 제목 로그 (디버깅용)
        items.forEach((item, itemIndex) => {
          if (item.title) {
            console.log(
              `[Battlepage] URL ${index + 1} 아이템 ${
                itemIndex + 1
              }: ${item.title}`,
            );
          }
        });

        detectedList.push(items);
      } catch (pageError) {
        console.error(
          `[Battlepage] URL ${index + 1} 크롤링 중 에러 발생:`,
          pageError,
        );
        console.error(`[Battlepage] 에러 URL: ${url}`);
        console.error(
          `[Battlepage] 에러 스택:`,
          pageError instanceof Error ? pageError.stack : "Stack not available",
        );
        detectedList.push([]); // 해당 URL 실패 시 빈 배열 추가
      }
    }

    const flattenedList = detectedList.flat();
    console.log(
      `[Battlepage] 전체 크롤링 완료: 총 ${flattenedList.length}개 아이템 수집`,
    );

    return flattenedList;
  } catch (error) {
    console.error("[Battlepage] 크롤링 중 치명적 에러 발생:", error);
    console.error(
      "[Battlepage] 에러 스택:",
      error instanceof Error ? error.stack : "Stack not available",
    );
    throw error; // 상위로 에러 전파
  }
}

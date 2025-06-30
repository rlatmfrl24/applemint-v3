import * as cheerio from "cheerio";

// 브라우저처럼 보이게 하는 헤더 설정
const crawlHeaders = {
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
};

// 간단한 지연 함수
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function crawlArcalive() {
    console.log("[Arcalive] 크롤링 시작");

    const baseUrl = "https://arca.live";
    const target = "https://arca.live/b/iloveanimal?mode=best";
    const pageSize = 3;
    const targetList: string[] = [];

    Array.from({ length: pageSize }, (_, i) => {
        targetList.push(`${target}&p=${i + 1}`);
    });

    console.log(`[Arcalive] 크롤링 대상 URL 목록:`, targetList);

    try {
        const detectedList = [];

        // 동시 요청 대신 순차 처리로 변경 (rate limiting 방지)
        for (let index = 0; index < targetList.length; index++) {
            const url = targetList[index];
            console.log(`[Arcalive] 페이지 ${index + 1} 크롤링 시작: ${url}`);

            try {
                // 각 요청 사이에 지연 추가
                if (index > 0) {
                    const delayMs = 300 + Math.random() * 400; // 300-700ms 랜덤 지연
                    console.log(
                        `[Arcalive] ${delayMs.toFixed(0)}ms 지연 후 요청...`,
                    );
                    await delay(delayMs);
                }

                const response = await fetch(url, {
                    headers: crawlHeaders,
                });
                console.log(
                    `[Arcalive] 페이지 ${
                        index + 1
                    } 응답 상태: ${response.status}`,
                );

                if (!response.ok) {
                    throw new Error(
                        `HTTP 에러: ${response.status} ${response.statusText}`,
                    );
                }

                const text = await response.text();
                console.log(
                    `[Arcalive] 페이지 ${
                        index + 1
                    } HTML 길이: ${text.length} 문자`,
                );

                const $ = cheerio.load(text);
                console.log(`[Arcalive] 페이지 ${index + 1} HTML 파싱 완료`);

                const itemList = $(".list-table.table")
                    .children(".vrow.column")
                    .filter((i, el) => {
                        return $(el).attr("href") !== undefined &&
                            $(el).find(".title").text().trim() !== "";
                    })
                    .map((i, el) => {
                        const arcaliveBadge = $(el).find(
                            ".vrow-inner .vrow-top .vcol.col-title .badges",
                        ).text().trim();

                        const itemUrl = baseUrl + $(el).attr("href")
                            //remove ?mode=best&p= query string by using regex
                            ?.replace(/\?mode=best&p=\d+/, "");

                        const title = $(el).find(".title").text().trim();

                        return {
                            url: itemUrl,
                            title: title,
                            description: "",
                            host: baseUrl,
                            tag: arcaliveBadge
                                ? ["arcalive", arcaliveBadge]
                                : ["arcalive"],
                        };
                    });

                const items = itemList.get();
                console.log(
                    `[Arcalive] 페이지 ${
                        index + 1
                    } 아이템 ${items.length}개 추출 완료`,
                );

                // 추출된 아이템들의 제목 로그 (디버깅용)
                items.forEach((item, itemIndex) => {
                    console.log(
                        `[Arcalive] 페이지 ${index + 1} 아이템 ${
                            itemIndex + 1
                        }: ${item.title}`,
                    );
                });

                detectedList.push(items);
            } catch (pageError) {
                console.error(
                    `[Arcalive] 페이지 ${index + 1} 크롤링 중 에러 발생:`,
                    pageError,
                );
                console.error(`[Arcalive] 에러 URL: ${url}`);
                console.error(
                    `[Arcalive] 에러 스택:`,
                    pageError instanceof Error
                        ? pageError.stack
                        : "Stack not available",
                );
                detectedList.push([]); // 해당 페이지 실패 시 빈 배열 추가
            }
        }

        const flattenedList = detectedList.flat();
        console.log(
            `[Arcalive] 전체 크롤링 완료: 총 ${flattenedList.length}개 아이템 수집`,
        );

        return flattenedList;
    } catch (error) {
        console.error("[Arcalive] 크롤링 중 치명적 에러 발생:", error);
        console.error(
            "[Arcalive] 에러 스택:",
            error instanceof Error ? error.stack : "Stack not available",
        );
        throw error; // 상위로 에러 전파
    }
}

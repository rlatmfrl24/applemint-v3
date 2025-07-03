import chromium from "@sparticuz/chromium";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";

// 타입 정의
interface CrawlResult {
    url: string;
    title: string;
    description: string;
    host: string;
    tag: string[];
}

interface BrowserInstance {
    browser: any;
    isLocal: boolean;
}

// 간단한 지연 함수
function _delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// 환경별 브라우저 인스턴스 생성
async function getBrowserInstance(): Promise<BrowserInstance> {
    const isLocal = process.env.NODE_ENV === "development";

    console.log(
        `[Arcalive Puppeteer] 환경: ${isLocal ? "Development" : "Production"}`,
    );

    let browser: any;

    if (isLocal) {
        // 로컬 환경: 일반 puppeteer 사용
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-web-security",
                    "--disable-features=VizDisplayCompositor",
                ],
            });
        } catch (localError) {
            console.log(
                "[Arcalive Puppeteer] puppeteer.launch 실패, puppeteer-core로 fallback 시도",
                localError instanceof Error
                    ? localError.message
                    : String(localError),
            );
            // puppeteer.launch 실패 시 puppeteer-core로 fallback
            try {
                const executablePath = await chromium.executablePath();
                browser = await puppeteerCore.launch({
                    executablePath,
                    headless: true,
                    args: [
                        ...chromium.args,
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--disable-web-security",
                        "--disable-features=VizDisplayCompositor",
                    ],
                });
            } catch (fallbackError) {
                console.error(
                    "[Arcalive Puppeteer] 로컬 환경 chromium fallback 실패:",
                    fallbackError,
                );
                throw fallbackError;
            }
        }
    } else {
        // Vercel 배포 환경: puppeteer-core + chromium 사용
        try {
            console.log(
                "[Arcalive Puppeteer] chromium executablePath 확인 시도",
            );
            const executablePath = await chromium.executablePath();
            console.log(
                "[Arcalive Puppeteer] chromium executablePath:",
                executablePath,
            );

            browser = await puppeteerCore.launch({
                executablePath,
                headless: true,
                args: [
                    ...chromium.args,
                    "--font-render-hinting=none",
                    "--hide-scrollbars",
                    "--disable-web-security",
                    "--disable-animations",
                    "--disable-background-timer-throttling",
                    "--disable-restore-session-state",
                    "--single-process",
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            });
        } catch (productionError) {
            console.error(
                "[Arcalive Puppeteer] Production 환경 chromium 실행 실패:",
                productionError,
            );

            // 추가적인 fallback 시도
            try {
                console.log(
                    "[Arcalive Puppeteer] Production 환경 fallback 시도",
                );

                // chromium 패키지 없이 직접 경로 시도
                const fallbackPaths = [
                    "/opt/render/chrome/chrome",
                    "/usr/bin/chromium-browser",
                    "/usr/bin/chromium",
                    "/usr/bin/google-chrome",
                    "/usr/bin/google-chrome-stable",
                ];

                let workingPath = null;
                for (const path of fallbackPaths) {
                    try {
                        const fs = await import("fs");
                        if (fs.existsSync(path)) {
                            workingPath = path;
                            break;
                        }
                    } catch {
                        continue;
                    }
                }

                if (workingPath) {
                    console.log(
                        "[Arcalive Puppeteer] 시스템 Chrome 경로 발견:",
                        workingPath,
                    );
                    browser = await puppeteerCore.launch({
                        executablePath: workingPath,
                        headless: true,
                        args: [
                            "--no-sandbox",
                            "--disable-setuid-sandbox",
                            "--disable-dev-shm-usage",
                            "--disable-gpu",
                            "--disable-web-security",
                            "--disable-features=VizDisplayCompositor",
                            "--font-render-hinting=none",
                            "--hide-scrollbars",
                            "--disable-animations",
                            "--disable-background-timer-throttling",
                            "--disable-restore-session-state",
                            "--single-process",
                        ],
                    });
                } else {
                    console.error(
                        "[Arcalive Puppeteer] 사용 가능한 Chrome 실행 파일을 찾을 수 없음",
                    );
                    throw new Error(
                        "Chrome 실행 파일을 찾을 수 없습니다. Vercel 환경에서 @sparticuz/chromium 패키지 설치를 확인해주세요.",
                    );
                }
            } catch (fallbackError) {
                console.error(
                    "[Arcalive Puppeteer] 모든 fallback 실패:",
                    fallbackError,
                );
                throw new Error(
                    `Chrome 브라우저를 실행할 수 없습니다. 원본 에러: ${
                        productionError instanceof Error
                            ? productionError.message
                            : String(productionError)
                    }`,
                );
            }
        }
    }

    return { browser, isLocal };
}

// 페이지 설정 및 최적화
async function setupPage(browser: any) {
    const page = await browser.newPage();

    // User-Agent 설정 (봇 탐지 우회)
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    // 추가 헤더 설정
    await page.setExtraHTTPHeaders({
        Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
    });

    // 뷰포트 설정
    await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
    });

    // 불필요한 리소스 차단 (성능 최적화)
    await page.setRequestInterception(true);
    page.on("request", (req: any) => {
        const resourceType = req.resourceType();
        if (
            resourceType === "stylesheet" || resourceType === "font" ||
            resourceType === "image"
        ) {
            req.abort();
        } else {
            req.continue();
        }
    });

    return page;
}

// 페이지 크롤링 함수
async function crawlPage(
    page: any,
    url: string,
    pageIndex: number,
): Promise<CrawlResult[]> {
    console.log(
        `[Arcalive Puppeteer] 페이지 ${pageIndex + 1} 크롤링 시작: ${url}`,
    );

    try {
        // 페이지 로드 (타임아웃 단축)
        const response = await page.goto(url, {
            waitUntil: "domcontentloaded", // networkidle2에서 domcontentloaded로 변경
            timeout: 20000, // 30초에서 20초로 단축
        });

        if (!response || !response.ok()) {
            throw new Error(
                `페이지 로드 실패: ${response?.status()} ${response?.statusText()}`,
            );
        }

        console.log(`[Arcalive Puppeteer] 페이지 ${pageIndex + 1} 로드 완료`);

        // 페이지 완전 로드 대기 (시간 단축)
        await _delay(1000); // 2초에서 1초로 단축

        // 리스트 테이블 요소 대기 (시간 단축)
        await page.waitForSelector(".list-table.table", { timeout: 5000 }); // 10초에서 5초로 단축

        // HTML 내용 추출
        const htmlContent = await page.content();
        console.log(
            `[Arcalive Puppeteer] 페이지 ${
                pageIndex + 1
            } HTML 길이: ${htmlContent.length} 문자`,
        );

        // Cheerio로 파싱
        const $ = cheerio.load(htmlContent);

        const baseUrl = "https://arca.live";
        const itemList = $(".list-table.table")
            .children(".vrow.column")
            .filter((_i, el) => {
                return $(el).attr("href") !== undefined &&
                    $(el).find(".title").text().trim() !== "";
            })
            .map((_i, el) => {
                const arcaliveBadge = $(el)
                    .find(".vrow-inner .vrow-top .vcol.col-title .badges")
                    .text()
                    .trim();

                const itemUrl = baseUrl +
                    $(el)
                        .attr("href")
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
            `[Arcalive Puppeteer] 페이지 ${
                pageIndex + 1
            } 아이템 ${items.length}개 추출 완료`,
        );

        // 추출된 아이템들의 제목 로그
        items.forEach((item, itemIndex) => {
            console.log(
                `[Arcalive Puppeteer] 페이지 ${pageIndex + 1} 아이템 ${
                    itemIndex + 1
                }: ${item.title}`,
            );
        });

        return items;
    } catch (error) {
        console.error(
            `[Arcalive Puppeteer] 페이지 ${pageIndex + 1} 크롤링 중 에러 발생:`,
            error,
        );
        throw error;
    }
}

// 메인 크롤링 함수
export async function crawlArcalivePuppeteer(): Promise<CrawlResult[]> {
    const startTime = Date.now();
    console.log("[Arcalive Puppeteer] 크롤링 시작");

    const target = "https://arca.live/b/iloveanimal?mode=best";
    const pageSize = 2; // Vercel 무료 플랜 60초 제한에 맞추기 위해 2페이지로 제한
    const targetList: string[] = [];

    // 대상 URL 목록 생성
    Array.from({ length: pageSize }, (_, i) => {
        targetList.push(`${target}&p=${i + 1}`);
    });

    console.log("[Arcalive Puppeteer] 크롤링 대상 URL 목록:", targetList);

    let browserInstance: BrowserInstance | null = null;
    let page: any = null;

    try {
        // 브라우저 인스턴스 생성
        browserInstance = await getBrowserInstance();
        console.log("[Arcalive Puppeteer] 브라우저 인스턴스 생성 완료");

        // 페이지 설정
        page = await setupPage(browserInstance.browser);
        console.log("[Arcalive Puppeteer] 페이지 설정 완료");

        const detectedList: CrawlResult[] = [];

        // 순차적으로 페이지 크롤링 (rate limiting 방지)
        for (let index = 0; index < targetList.length; index++) {
            const url = targetList[index];

            try {
                const items = await crawlPage(page, url, index);
                detectedList.push(...items);

                // 다음 페이지 요청 전 잠시 대기 (시간 단축)
                if (index < targetList.length - 1) {
                    await _delay(500); // 1초에서 0.5초로 단축
                }
            } catch (pageError) {
                console.error(
                    `[Arcalive Puppeteer] 페이지 ${index + 1} 크롤링 실패:`,
                    pageError,
                );
                console.error(`[Arcalive Puppeteer] 에러 URL: ${url}`);
                // 개별 페이지 실패 시 계속 진행
                continue;
            }
        }

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        console.log(
            `[Arcalive Puppeteer] 전체 크롤링 완료: 총 ${detectedList.length}개 아이템 수집`,
        );
        console.log(`[Arcalive Puppeteer] 소요 시간: ${duration}초`);

        return detectedList;
    } catch (error) {
        console.error(
            "[Arcalive Puppeteer] 크롤링 중 치명적 에러 발생:",
            error,
        );
        console.error(
            "[Arcalive Puppeteer] 에러 스택:",
            error instanceof Error ? error.stack : "Stack not available",
        );
        throw error;
    } finally {
        // 리소스 정리
        try {
            if (page) {
                await page.close();
                console.log("[Arcalive Puppeteer] 페이지 정리 완료");
            }
            if (browserInstance?.browser) {
                await browserInstance.browser.close();
                console.log("[Arcalive Puppeteer] 브라우저 정리 완료");
            }
        } catch (cleanupError) {
            console.error(
                "[Arcalive Puppeteer] 리소스 정리 중 에러:",
                cleanupError,
            );
        }
    }
}

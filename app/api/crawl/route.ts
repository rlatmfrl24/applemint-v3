import { type NextRequest, NextResponse } from "next/server";
import { crawlArcalive } from "./arcalive";
import { crawlBattlepage } from "./battlepage";
import {
	type CrawlSourceResult,
	type CrawlTarget,
	getErrorMessage,
	isCrawlTarget,
} from "./contracts";
import { crawlInsagirl } from "./insagirl";
import { hasMinimumInternalSecretLength, hasValidInternalSecret } from "./internal-auth";
import { crawlIssuelink } from "./issuelink";
import { debugLog, infoLog } from "./logger";

const CRAWLERS: Record<CrawlTarget, () => Promise<CrawlSourceResult>> = {
	arcalive: crawlArcalive,
	battlepage: crawlBattlepage,
	insagirl: crawlInsagirl,
	issuelink: crawlIssuelink,
};

async function runCrawlerWithRetry(target: CrawlTarget) {
	let latestResult: CrawlSourceResult | null = null;

	for (let attempt = 1; attempt <= 2; attempt += 1) {
		latestResult = await CRAWLERS[target]();
		if (latestResult.succeeded > 0) {
			return latestResult;
		}

		if (attempt < 2) {
			const delay = 1000 * 2 ** (attempt - 1);
			debugLog(`[Crawl API] ${target} 전체 요청 실패, ${delay}ms 후 재시도`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	return latestResult;
}

export async function POST(request: NextRequest) {
	const startTime = Date.now();
	const expectedSecret = process.env.CRAWL_INTERNAL_SECRET;

	if (!hasMinimumInternalSecretLength(expectedSecret)) {
		return NextResponse.json(
			{ error: "내부 크롤링 인증 정보가 올바르게 설정되지 않았습니다." },
			{ status: 503 }
		);
	}

	if (!hasValidInternalSecret(request.headers.get("x-applemint-internal-secret"), expectedSecret)) {
		return NextResponse.json({ error: "인증되지 않은 내부 요청입니다." }, { status: 401 });
	}

	const body = (await request.json().catch(() => null)) as { target?: unknown } | null;
	if (!isCrawlTarget(body?.target)) {
		return NextResponse.json({ error: "지원하지 않는 크롤링 대상입니다." }, { status: 400 });
	}

	const target = body.target;
	infoLog(`[Crawl API] ${target} 크롤링 시작`);

	try {
		const result = await runCrawlerWithRetry(target);
		const durationMs = Date.now() - startTime;

		if (!result || result.succeeded === 0) {
			const status = result?.failures.some((failure) => failure.timeout) ? 504 : 502;
			return NextResponse.json(
				{
					error: "모든 소스 요청이 실패했습니다.",
					target,
					failures: result?.failures ?? [],
					durationMs,
				},
				{ status }
			);
		}

		infoLog(`[Crawl API] ${target} 크롤링 완료: ${result.items.length}개, ${durationMs}ms`);
		return NextResponse.json({
			target,
			...result,
			durationMs,
		});
	} catch (error) {
		const message = getErrorMessage(error);
		console.error(`[Crawl API] ${target} 크롤링 실패: ${message}`);
		return NextResponse.json(
			{
				error: "크롤링 중 오류가 발생했습니다.",
				target,
				durationMs: Date.now() - startTime,
			},
			{ status: 500 }
		);
	}
}

import { type NextRequest, NextResponse } from "next/server";
import { type CrawlExecutionResult, getErrorMessage, isCrawlTarget } from "./contracts";
import { runCrawlerWithRetry } from "./crawl-runner";
import { hasMinimumInternalSecretLength, hasValidInternalSecret } from "./internal-auth";
import { infoLog } from "./logger";

function emptyExecutionResult(): CrawlExecutionResult {
	return {
		items: [],
		attempted: 0,
		succeeded: 0,
		failures: [],
		warnings: [],
		parserObservations: [],
		retryCount: 0,
		parserValidCount: 0,
		parserMinimumCount: 0,
	};
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

		if (result.succeeded === 0) {
			const allFailuresTimedOut =
				result.failures.length > 0 && result.failures.every((failure) => failure.timeout === true);
			const status = allFailuresTimedOut ? 504 : 502;
			return NextResponse.json(
				{
					error: "모든 소스 요청이 실패했습니다.",
					target,
					...result,
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
				...emptyExecutionResult(),
				durationMs: Date.now() - startTime,
			},
			{ status: 500 }
		);
	}
}

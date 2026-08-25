import type { CrawlItemType } from "@/lib/type-defs";
import {
	type CrawlAdapterOptions,
	type CrawlFailure,
	type CrawlSourceResult,
	type CrawlWarning,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { DOGDRIP_BASE_URL, parseDogdripHtml } from "./dogdrip-parser";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { debugLog } from "./logger";
import { adaptParserOutcome } from "./parser-adapter";

export const DOGDRIP_TARGET = `${DOGDRIP_BASE_URL}/dogdrip?sort_index=popular`;

const DOGDRIP_BROWSER_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

interface DogdripPageResult {
	items: CrawlItemType[];
	warnings: CrawlWarning[];
	failure?: CrawlFailure;
	parserObservations: CrawlSourceResult["parserObservations"];
}

function isCloudflareAccessDenied(response: Response, body: string) {
	if (response.status !== 403) return false;
	return (
		response.headers.get("cf-mitigated")?.toLowerCase() === "challenge" ||
		response.headers.get("server")?.toLowerCase().includes("cloudflare") === true ||
		body.includes("/cdn-cgi/") ||
		body.toLowerCase().includes("cloudflare")
	);
}

export async function crawlDogdrip(options: CrawlAdapterOptions = {}): Promise<CrawlSourceResult> {
	debugLog("[DogDrip] 인기글 크롤링 시작");

	const requestedUrls = new Set(options.urls ?? [DOGDRIP_TARGET]);
	const targetList = requestedUrls.has(DOGDRIP_TARGET) ? [DOGDRIP_TARGET] : [];
	const results = await Promise.all(
		targetList.map(async (url): Promise<DogdripPageResult> => {
			try {
				const response = await fetchWithTimeout(url, {
					signal: options.signal,
					cache: "no-store",
					headers: {
						accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
						"accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
						"user-agent": DOGDRIP_BROWSER_USER_AGENT,
					},
				});
				const body = await response.text();
				if (!response.ok) {
					if (isCloudflareAccessDenied(response, body)) {
						return {
							items: [],
							warnings: [],
							parserObservations: [],
							failure: {
								url,
								message: `HTTP ${response.status} Cloudflare access denied`,
								kind: "upstream-challenge",
							},
						};
					}
					throw new Error(`HTTP ${response.status} ${response.statusText}`);
				}

				const outcome = parseDogdripHtml(body);
				const parsed = adaptParserOutcome(url, outcome);
				debugLog(
					`[DogDrip] parser=${outcome.status} candidates=${outcome.candidateCount} valid=${outcome.items.length} discarded=${outcome.discardedCount}`
				);
				return { ...parsed, parserObservations: [parsed.observation] };
			} catch (error) {
				const message = getErrorMessage(error);
				console.error(`[DogDrip] 크롤링 실패: ${message}`);
				return {
					items: [],
					warnings: [],
					parserObservations: [],
					failure: { url, message, kind: "network", timeout: isTimeoutError(error) },
				};
			}
		})
	);

	const failures = results.flatMap((result) => (result.failure ? [result.failure] : []));
	return {
		items: results.flatMap((result) => result.items),
		attemptedUrls: targetList,
		attempted: targetList.length,
		succeeded: targetList.length - failures.length,
		failures,
		warnings: results.flatMap((result) => result.warnings),
		parserObservations: results.flatMap((result) => result.parserObservations),
	};
}

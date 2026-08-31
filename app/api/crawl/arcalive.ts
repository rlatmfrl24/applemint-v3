import { randomUUID } from "node:crypto";
import type { CrawlItemType } from "@/lib/type-defs";
import { parseArcaliveApiPayload } from "./arcalive-parser";
import {
	type CrawlAdapterOptions,
	type CrawlFailure,
	type CrawlSourceResult,
	type CrawlWarning,
	getErrorMessage,
	isTimeoutError,
} from "./contracts";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { debugLog } from "./logger";
import { adaptParserOutcome } from "./parser-adapter";

const ARCALIVE_API_BASE_URL = "https://arca.live/api/app/list/channel/iloveanimal";
const ARCALIVE_API_PAGE_COUNT = 3;
const ARCALIVE_API_PAGE_LIMIT = 45;
const ARCALIVE_APP_USER_AGENT = "net.umanle.arca.android/0.9.85";
const CLOUDFLARE_CHALLENGE_PATH = "/cdn-cgi/challenge-platform/";

interface ArcalivePageResult {
	items: CrawlItemType[];
	warnings: CrawlWarning[];
	failure?: CrawlFailure;
	parserObservations: CrawlSourceResult["parserObservations"];
	next: Record<string, string> | null;
	deviceToken: string;
}

interface ArcaliveAttempt {
	url: string;
	result: ArcalivePageResult;
}

function createArcaliveApiUrl(cursor: Record<string, string> | null = null) {
	const url = new URL(ARCALIVE_API_BASE_URL);
	url.searchParams.set("mode", "best");
	url.searchParams.set("limit", String(ARCALIVE_API_PAGE_LIMIT));
	if (cursor) {
		url.searchParams.set("before", cursor.before);
		url.searchParams.set("offset", cursor.offset);
	}
	return url.href;
}

function isCloudflareChallenge(response: Response, body: string) {
	if (response.status !== 403) return false;
	if (response.headers.get("cf-mitigated")?.toLowerCase() === "challenge") return true;
	return (
		response.headers.get("server")?.trim().toLowerCase() === "cloudflare" &&
		body.includes(CLOUDFLARE_CHALLENGE_PATH)
	);
}

async function crawlArcalivePage(
	url: string,
	index: number,
	deviceToken: string,
	signal?: AbortSignal
): Promise<ArcalivePageResult> {
	try {
		const response = await fetchWithTimeout(url, {
			signal,
			cache: "no-store",
			headers: {
				accept: "application/json",
				"user-agent": ARCALIVE_APP_USER_AGENT,
				"x-device-token": deviceToken,
			},
		});
		const responseBody = await response.text();
		const nextDeviceToken = response.headers.get("x-device-token") || deviceToken;
		if (!response.ok) {
			if (isCloudflareChallenge(response, responseBody)) {
				return {
					items: [],
					warnings: [],
					parserObservations: [],
					next: null,
					deviceToken: nextDeviceToken,
					failure: {
						url,
						message: `HTTP ${response.status} Cloudflare Challenge`,
						kind: "upstream-challenge",
					},
				};
			}
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		let payload: unknown = null;
		try {
			payload = JSON.parse(responseBody) as unknown;
		} catch {
			// 손상된 JSON은 parser failure로 기록합니다.
		}
		const page = parseArcaliveApiPayload(payload);
		const parsed = adaptParserOutcome(url, page.outcome);
		debugLog(
			`[Arcalive] API 페이지 ${index + 1} parser=${page.outcome.status} candidates=${page.outcome.candidateCount} valid=${page.outcome.items.length} discarded=${page.outcome.discardedCount}`
		);
		return {
			...parsed,
			parserObservations: [parsed.observation],
			next: page.next,
			deviceToken: nextDeviceToken,
		};
	} catch (error) {
		const message = getErrorMessage(error);
		console.error(`[Arcalive] API 페이지 ${index + 1} 크롤링 실패: ${message}`);
		return {
			items: [],
			warnings: [],
			parserObservations: [],
			next: null,
			deviceToken,
			failure: { url, message, kind: "network", timeout: isTimeoutError(error) },
		};
	}
}

async function crawlArcaliveCursorPages(signal?: AbortSignal): Promise<ArcaliveAttempt[]> {
	const attempts: ArcaliveAttempt[] = [];
	let deviceToken: string = randomUUID();
	let cursor: Record<string, string> | null = null;
	for (let index = 0; index < ARCALIVE_API_PAGE_COUNT; index += 1) {
		const url = createArcaliveApiUrl(cursor);
		const result = await crawlArcalivePage(url, index, deviceToken, signal);
		deviceToken = result.deviceToken;
		attempts.push({ url, result });
		if (!result.next) break;
		cursor = result.next;
	}
	return attempts;
}

export async function crawlArcalive(options: CrawlAdapterOptions = {}): Promise<CrawlSourceResult> {
	debugLog("[Arcalive] 앱 API 크롤링 시작");

	const attempts = await crawlArcaliveCursorPages(options.signal);
	const failures = attempts.flatMap(({ result }) => (result.failure ? [result.failure] : []));
	const warnings = attempts.flatMap(({ result }) => result.warnings);
	const parserObservations = attempts.flatMap(({ result }) => result.parserObservations);
	const items = new Map<string, CrawlItemType>();
	for (const { result } of attempts) {
		for (const item of result.items) {
			if (!items.has(item.url)) items.set(item.url, item);
		}
	}

	debugLog(`[Arcalive] 앱 API 크롤링 완료: 총 ${items.size}개 아이템 수집`);
	return {
		items: Array.from(items.values()),
		attemptedUrls: attempts.map(({ url }) => url),
		attempted: attempts.length,
		succeeded: attempts.length - failures.length,
		failures,
		warnings,
		parserObservations,
	};
}

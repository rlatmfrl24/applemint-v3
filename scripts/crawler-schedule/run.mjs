import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const CRAWL_TARGETS = ["arcalive", "battlepage", "insagirl"];
const MAX_WORKERS = 2;
const CAPACITY_RETRIES = 2;
const TRANSPORT_RETRIES = 1;

function normalizeBaseUrl(value) {
	if (!value) return null;
	try {
		const url = new URL(value);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/$/u, "");
	} catch {
		return null;
	}
}

async function parseResponse(response) {
	return response.json().catch(() => ({ error: `HTTP ${response.status}` }));
}

function getCapacityRetryDelay(response, data) {
	if (response.status !== 429 || data?.reason !== "capacity") return null;
	return Math.max(
		1,
		Math.min(60, Number(data.retryAfterSeconds ?? response.headers.get("Retry-After") ?? 30))
	);
}

export async function requestScheduledCrawl(
	target,
	{ baseUrl, internalSecret, fetchImplementation = fetch, delayImplementation = delay } = {}
) {
	let capacityAttempts = 0;
	let transportAttempts = 0;
	while (true) {
		let response;
		try {
			response = await fetchImplementation(`${baseUrl}/api/crawl/scheduled`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-applemint-internal-secret": internalSecret,
				},
				body: JSON.stringify({ target }),
				signal: AbortSignal.timeout(65_000),
			});
		} catch (error) {
			if (transportAttempts >= TRANSPORT_RETRIES) throw error;
			transportAttempts += 1;
			await delayImplementation(5000);
			continue;
		}

		const data = await parseResponse(response);
		const capacityRetryDelay = getCapacityRetryDelay(response, data);
		if (capacityRetryDelay !== null) {
			if (capacityAttempts >= CAPACITY_RETRIES) {
				throw new Error(`${target} capacity 재시도 한도를 초과했습니다.`);
			}
			capacityAttempts += 1;
			await delayImplementation(capacityRetryDelay * 1000);
			continue;
		}
		if (!response.ok) {
			throw new Error(
				`${target} 예약 크롤링 실패 (${response.status}): ${String(data?.error ?? "Unknown error")}`
			);
		}
		return data;
	}
}

export async function runScheduledCrawls({
	baseUrl,
	internalSecret,
	fetchImplementation = fetch,
	delayImplementation = delay,
	logger = console,
} = {}) {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	if (!normalizedBaseUrl) throw new Error("APP_BASE_URL이 올바른 HTTP(S) URL이 아닙니다.");
	if (typeof internalSecret !== "string" || Buffer.byteLength(internalSecret, "utf8") < 32) {
		throw new Error("CRAWL_INTERNAL_SECRET은 32바이트 이상이어야 합니다.");
	}

	const results = new Array(CRAWL_TARGETS.length);
	const failures = [];
	let nextIndex = 0;
	async function worker() {
		while (nextIndex < CRAWL_TARGETS.length) {
			const index = nextIndex;
			nextIndex += 1;
			const target = CRAWL_TARGETS[index];
			try {
				const result = await requestScheduledCrawl(target, {
					baseUrl: normalizedBaseUrl,
					internalSecret,
					fetchImplementation,
					delayImplementation,
				});
				results[index] = result;
				logger.info(`[crawler-schedule] ${target}`, result);
			} catch (error) {
				failures.push({ target, error });
				logger.error(
					`[crawler-schedule] ${target} failed`,
					error instanceof Error ? error.message : error
				);
			}
		}
	}

	await Promise.all(Array.from({ length: MAX_WORKERS }, () => worker()));
	if (failures.length > 0) {
		throw new AggregateError(
			failures.map(({ error }) => error),
			`${failures.map(({ target }) => target).join(", ")} 예약 크롤링에 실패했습니다.`
		);
	}
	return results;
}

async function main() {
	await runScheduledCrawls({
		baseUrl: process.env.APP_BASE_URL,
		internalSecret: process.env.CRAWL_INTERNAL_SECRET,
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error("[crawler-schedule] failed", error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}

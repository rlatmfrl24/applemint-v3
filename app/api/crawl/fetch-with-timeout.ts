export const SOURCE_FETCH_TIMEOUT_MS = 15_000;

export function fetchWithTimeout(
	input: string | URL | Request,
	init: RequestInit = {},
	timeoutMs = SOURCE_FETCH_TIMEOUT_MS
) {
	return fetch(input, {
		...init,
		signal: init.signal ?? AbortSignal.timeout(timeoutMs),
	});
}

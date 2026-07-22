const SOURCE_FETCH_TIMEOUT_MS = 15_000;

function combineSignals(parentSignal: AbortSignal, timeoutSignal: AbortSignal) {
	const controller = new AbortController();
	const forwardAbort = (signal: AbortSignal) => {
		if (!controller.signal.aborted) controller.abort(signal.reason);
	};
	if (parentSignal.aborted) {
		forwardAbort(parentSignal);
	} else {
		parentSignal.addEventListener("abort", () => forwardAbort(parentSignal), { once: true });
	}
	timeoutSignal.addEventListener("abort", () => forwardAbort(timeoutSignal), { once: true });
	return controller.signal;
}

export function fetchWithTimeout(
	input: string | URL | Request,
	init: RequestInit = {},
	timeoutMs = SOURCE_FETCH_TIMEOUT_MS
) {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	return fetch(input, {
		...init,
		signal: init.signal ? combineSignals(init.signal, timeoutSignal) : timeoutSignal,
	});
}

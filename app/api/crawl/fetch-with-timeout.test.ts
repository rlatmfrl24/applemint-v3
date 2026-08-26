import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./fetch-with-timeout";

function abortableFetch() {
	return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
		const signal = init?.signal;
		return new Promise<Response>((_resolve, reject) => {
			if (!signal) return;
			if (signal.aborted) {
				reject(signal.reason);
				return;
			}
			signal.addEventListener("abort", () => reject(signal.reason), { once: true });
		});
	});
}

describe("fetchWithTimeout", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("timeout signal이 abort되면 fetch를 같은 reason으로 중단한다", async () => {
		const timeout = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
		const fetchMock = abortableFetch();
		vi.stubGlobal("fetch", fetchMock);

		const request = fetchWithTimeout("https://source.test", {}, 1234);
		const reason = new DOMException("timed out", "TimeoutError");
		timeout.abort(reason);

		await expect(request).rejects.toBe(reason);
		expect(AbortSignal.timeout).toHaveBeenCalledWith(1234);
	});

	it("parent abort를 결합 signal로 전달한다", async () => {
		const timeout = new AbortController();
		const parent = new AbortController();
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
		const fetchMock = abortableFetch();
		vi.stubGlobal("fetch", fetchMock);

		const request = fetchWithTimeout("https://source.test", { signal: parent.signal });
		const reason = new DOMException("cancelled", "AbortError");
		parent.abort(reason);

		await expect(request).rejects.toBe(reason);
		expect(fetchMock.mock.calls[0][1]?.signal).not.toBe(parent.signal);
	});

	it("이미 abort된 parent signal을 fetch 호출 전에 보존한다", async () => {
		const timeout = new AbortController();
		const parent = new AbortController();
		const reason = new DOMException("already cancelled", "AbortError");
		parent.abort(reason);
		vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
		const fetchMock = abortableFetch();
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchWithTimeout("https://source.test", { signal: parent.signal })).rejects.toBe(
			reason
		);
		const combinedSignal = fetchMock.mock.calls[0][1]?.signal;
		expect(combinedSignal?.aborted).toBe(true);
		expect(combinedSignal?.reason).toBe(reason);
	});
});

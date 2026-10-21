// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	collectionA,
	collectionB,
	collections,
	deferred,
	formTransport,
	jobId,
	queryHarness,
	recommendationStatus,
	source,
} from "@/test-support/bookmark-form-fixtures";
import { useBookmarkSaveRecommendation } from "./use-bookmark-save-recommendation";

const backend = vi.hoisted(() => ({ client: {} as ReturnType<typeof formTransport> }));
vi.mock("@/trpc/client", () => ({ useTRPCClient: () => backend.client }));

beforeEach(() => {
	backend.client = formTransport();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function mount(recommendationId?: string) {
	const harness = queryHarness();
	return {
		...renderHook(() => useBookmarkSaveRecommendation(source, recommendationId), harness),
		...harness,
	};
}

describe("bookmark save recommendation", () => {
	it("registers a request and applies the completed recommendation with its collection version", async () => {
		const { result } = mount();
		await waitFor(() => expect(result.current.applied).toBe(jobId));
		expect(result.current.selection).toEqual({ id: collectionB.id, version: 7 });
		expect(result.current.origin).toBe("AI 추천");
		expect(result.current.busy).toBe(false);
		expect(backend.client.bookmarkAI.recommend.mutate).toHaveBeenCalledWith({
			threadId: source.id,
			title: source.title,
			requestId: expect.any(String),
		});
	});

	it("selects an unambiguous site collection without requesting AI", async () => {
		backend.client.bookmarkCollection.list.query.mockResolvedValue([
			{ ...collectionA, name: "example" },
		]);
		backend.client.bookmarkImport.configuration.query.mockResolvedValue({ openrouter: false });
		const { result } = mount();
		await waitFor(() => expect(result.current.origin).toBe("사이트 일치"));
		expect(result.current.selection).toEqual({ id: collectionA.id, version: collectionA.version });
		expect(backend.client.bookmarkAI.recommend.mutate).not.toHaveBeenCalled();
	});

	it("allows manual selection when AI is not configured", async () => {
		backend.client.bookmarkImport.configuration.query.mockResolvedValue({ openrouter: false });
		const { result } = mount();
		await waitFor(() => expect(result.current.message).toContain("AI 설정"));
		act(() => result.current.choose(collectionA.id));
		expect(result.current.selection).toEqual({ id: collectionA.id, version: 3 });
		expect(result.current.origin).toBe("직접 선택");
		expect(result.current.busy).toBe(false);
		act(() => result.current.choose(null));
		expect(result.current.selection).toEqual({ id: null, version: undefined });
	});

	it("uses an existing job without registering another request and permits an unclassified result", async () => {
		backend.client.bookmarkAI.recommendation.query.mockResolvedValue(
			recommendationStatus(
				{},
				{ collectionId: null, collectionVersion: null, basis: "uncertain", confidence: 0 }
			)
		);
		const { result } = mount(jobId);
		await waitFor(() => expect(result.current.applied).toBe(jobId));
		expect(result.current.selection).toEqual({ id: null, version: undefined });
		expect(backend.client.bookmarkAI.recommend.mutate).not.toHaveBeenCalled();
	});

	it.each([
		{ threadId: "other", url: source.url, title: source.title },
		{ threadId: source.id, url: "https://other.example", title: source.title },
		{ threadId: source.id, url: source.url, title: "Older title" },
	])("does not apply a job for another draft: %j", async (scope) => {
		backend.client.bookmarkAI.recommendation.query.mockResolvedValue(
			recommendationStatus({ scope })
		);
		const { result } = mount(jobId);
		await waitFor(() =>
			expect(result.current.message).toContain("이전 추천을 적용하지 않았습니다")
		);
		expect(result.current.selection.id).toBeNull();
		expect(result.current.applied).toBeUndefined();
		expect(result.current.busy).toBe(false);
	});

	it.each(["failed", "paused"] as const)(
		"shows a %s job error and unlocks saving",
		async (state) => {
			backend.client.bookmarkAI.recommendation.query.mockResolvedValue(
				recommendationStatus(
					{ state, error: state === "failed" ? "Provider unavailable" : null },
					null
				)
			);
			const { result } = mount(jobId);
			await waitFor(() => expect(result.current.busy).toBe(false));
			expect(result.current.message).toContain(
				state === "failed" ? "Provider unavailable" : "추천을 완료하지 못했습니다"
			);
			expect(result.current.applied).toBeUndefined();
		}
	);

	it("does not apply a deleted or changed collection", async () => {
		backend.client.bookmarkCollection.list.query.mockResolvedValue([collectionA]);
		const { result } = mount(jobId);
		await waitFor(() => expect(result.current.message).toContain("추천 컬렉션이 변경되었습니다"));
		expect(result.current.selection.id).toBeNull();
		expect(result.current.applied).toBeUndefined();
	});

	it("preserves a title edited while the collection version check is pending", async () => {
		const pending = deferred<typeof collections>();
		backend.client.bookmarkCollection.list.query.mockReturnValue(pending.promise);
		const { result } = mount(jobId);
		await waitFor(() => expect(backend.client.bookmarkAI.recommendation.query).toHaveBeenCalled());
		act(() => result.current.changeTitle("My newer title"));
		await act(async () => pending.resolve(collections));
		await waitFor(() => expect(result.current.busy).toBe(false));
		expect(result.current.title).toBe("My newer title");
		expect(result.current.selection.id).toBeNull();
		expect(result.current.message).toContain("이전 추천을 적용하지 않았습니다");
	});

	it("ignores a result after the user changes selection even when the title stays the same", async () => {
		const pending = deferred<ReturnType<typeof recommendationStatus>>();
		backend.client.bookmarkAI.recommendation.query.mockReturnValue(pending.promise);
		const { result } = mount(jobId);
		await waitFor(() => expect(result.current.collections.data).toHaveLength(2));
		act(() => result.current.choose(collectionA.id));
		await act(async () => pending.resolve(recommendationStatus()));
		await waitFor(() => expect(result.current.busy).toBe(false));
		expect(result.current.selection.id).toBe(collectionA.id);
		expect(result.current.applied).toBeUndefined();
		expect(result.current.message).toContain("이전 추천을 적용하지 않았습니다");
	});

	it("manual mode cancels a pending preparation and ignores its eventual response", async () => {
		const pending = deferred<{ id: string }>();
		backend.client.bookmarkAI.recommend.mutate.mockReturnValue(pending.promise);
		const { result } = mount();
		await waitFor(() => expect(backend.client.bookmarkAI.recommend.mutate).toHaveBeenCalled());
		act(() => {
			result.current.useManual();
			result.current.choose(collectionA.id);
		});
		await act(async () => pending.resolve({ id: jobId }));
		expect(result.current.busy).toBe(false);
		expect(result.current.selection.id).toBe(collectionA.id);
		expect(result.current.jobId).toBeUndefined();
		expect(backend.client.bookmarkAI.recommendation.query).not.toHaveBeenCalled();
	});

	it("manual mode prevents a completed job from changing the selection", async () => {
		const pending = deferred<ReturnType<typeof recommendationStatus>>();
		backend.client.bookmarkAI.recommendation.query.mockReturnValue(pending.promise);
		const { result } = mount(jobId);
		await waitFor(() => expect(result.current.collections.data).toHaveLength(2));
		act(() => {
			result.current.useManual();
			result.current.choose(collectionA.id);
		});
		await act(async () => pending.resolve(recommendationStatus()));
		expect(result.current.selection.id).toBe(collectionA.id);
		expect(result.current.origin).toBe("직접 선택");
		expect(result.current.applied).toBeUndefined();
	});

	it("a fresh recommendation uses the edited title and clears previous approval metadata", async () => {
		const { result } = mount();
		await waitFor(() => expect(result.current.applied).toBe(jobId));
		act(() => result.current.changeTitle("  Revised title  "));
		expect(result.current.applied).toBeUndefined();
		expect(result.current.origin).toBeUndefined();
		backend.client.bookmarkAI.recommendation.query.mockResolvedValue(
			recommendationStatus({
				scope: { threadId: source.id, url: source.url, title: "Revised title" },
			})
		);
		await act(async () => result.current.start(true));
		await waitFor(() =>
			expect(backend.client.bookmarkAI.recommend.mutate).toHaveBeenCalledTimes(2)
		);
		expect(backend.client.bookmarkAI.recommend.mutate).toHaveBeenLastCalledWith(
			expect.objectContaining({ title: "Revised title" })
		);
	});

	it.each([new Error("Transport offline"), "unexpected response"])(
		"reports preparation failures without locking manual saving",
		async (error) => {
			backend.client.bookmarkAI.recommend.mutate.mockRejectedValue(error);
			const { result } = mount();
			await waitFor(() => expect(result.current.message).toBeTruthy());
			expect(result.current.busy).toBe(false);
			expect(result.current.message).toContain(
				error instanceof Error ? error.message : "추천을 준비하지 못했습니다"
			);
		}
	);

	it("exposes recommendation fetch errors for retry and releases the save lock", async () => {
		backend.client.bookmarkAI.recommendation.query.mockRejectedValue(new Error("Status offline"));
		const { result } = mount(jobId);
		await waitFor(() =>
			expect(result.current.recommendation.error?.message).toBe("Status offline")
		);
		expect(result.current.busy).toBe(false);
		backend.client.bookmarkAI.recommendation.query.mockResolvedValue(recommendationStatus());
		await act(async () => result.current.recommendation.refetch());
		await waitFor(() => expect(result.current.applied).toBe(jobId));
	});

	it("marks long preparation as slow and clears the flag when manual mode is chosen", async () => {
		vi.useFakeTimers();
		backend.client.bookmarkCollection.list.query.mockReturnValue(new Promise(() => {}));
		const { result } = mount();
		await act(async () => vi.advanceTimersByTimeAsync(30001));
		expect(result.current.slow).toBe(true);
		act(() => result.current.useManual());
		expect(result.current.slow).toBe(false);
		expect(result.current.busy).toBe(false);
	});

	it("polls an in-progress recommendation until a completed result arrives", async () => {
		backend.client.bookmarkAI.recommendation.query.mockResolvedValue(
			recommendationStatus({ state: "processing" }, null)
		);
		const { result, cache } = mount(jobId);
		await waitFor(() => expect(result.current.recommendation.data?.job.state).toBe("processing"));
		expect(result.current.busy).toBe(true);
		act(() => cache.setQueryData(["bookmarks", "recommendation", jobId], recommendationStatus()));
		await waitFor(() => expect(result.current.applied).toBe(jobId));
		expect(result.current.busy).toBe(false);
	});

	it("ignores an earlier request that resolves after a newer recommendation was applied", async () => {
		const earlier = deferred<{ id: string }>();
		backend.client.bookmarkAI.recommend.mutate.mockReturnValueOnce(earlier.promise);
		const { result } = mount();
		await waitFor(() =>
			expect(backend.client.bookmarkAI.recommend.mutate).toHaveBeenCalledTimes(1)
		);
		await act(async () => result.current.start(true));
		await waitFor(() => expect(result.current.applied).toBe(jobId));
		await act(async () => earlier.resolve({ id: "77777777-7777-4777-8777-777777777777" }));
		expect(result.current.jobId).toBe(jobId);
		expect(result.current.applied).toBe(jobId);
		expect(result.current.selection.id).toBe(collectionB.id);
	});
});

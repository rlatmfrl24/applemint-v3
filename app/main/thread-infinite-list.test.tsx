// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ThreadPage, threadListQueryKey } from "@/lib/thread-list-contract";
import { applyMoveThreadOptimisticUpdates } from "@/lib/thread-query-cache";
import { ThreadInfiniteList } from "./thread-infinite-list";

const trpcClient = vi.hoisted(() => ({
	thread: {
		list: {
			query: vi.fn(),
		},
	},
}));

vi.mock("@/trpc/client", () => ({
	useTRPCClient: () => trpcClient,
}));

const inboxWindow = { cursor: "first-view", hasNew: false };

function createListClient(items: ThreadPage["items"] = []) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
	});
	queryClient.setQueryData(threadListQueryKey("inbox"), {
		pages: [{ items, nextCursor: null, inboxWindow }],
		pageParams: [undefined],
	});
	return queryClient;
}

function renderList(queryClient = createListClient(), emptyState?: React.ReactNode) {
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<ThreadInfiniteList
				state="inbox"
				emptyState={emptyState}
				renderItem={(thread) => <div>{thread.title}</div>}
			/>
		</QueryClientProvider>
	);
}

describe("ThreadInfiniteList 빈 상태 슬롯", () => {
	it("호출자가 제공한 Inbox 전용 빈 상태를 렌더링한다", () => {
		const html = renderList(createListClient(), <div data-testid="custom-empty">Inbox timer</div>);

		expect(html).toContain('data-testid="custom-empty"');
		expect(html).not.toContain("No data to display");
	});

	it("빈 상태를 제공하지 않은 기존 화면은 기본 No Data UI를 유지한다", () => {
		expect(renderList()).toContain("No data to display");
	});
});

afterEach(cleanup);

it("새 글 알림을 표시하고 갱신이 실패해도 보던 목록을 유지한 채 재시도한다", async () => {
	const rows = Array.from({ length: 26 }, (_, index) => ({
		id: String(26 - index),
		type: "normal",
		url: `https://example.com/${26 - index}`,
		title: `항목 ${26 - index}`,
		description: null,
		host: "example.com",
		state: "inbox" as const,
		created_at: "2026-11-23T00:00:00Z",
		captured_at: "2026-11-23T00:00:00Z",
		state_changed_at: "2026-11-23T00:00:00.123456Z",
		media_metadata: null,
	}));
	const [incoming, deleted, ...remaining] = rows;
	const client = createListClient(rows.slice(1, 25));
	const queryKey = threadListQueryKey("inbox");
	const list = trpcClient.thread.list.query;
	const refreshResponse = Promise.withResolvers<ThreadPage>();
	const failedRequest = Promise.withResolvers<ThreadPage>();
	const visiblePage = { items: remaining, nextCursor: null, inboxWindow };
	const latestPage = {
		items: [incoming, ...remaining.slice(0, 23)],
		nextCursor: "older",
		inboxWindow: { cursor: "updated-view", hasNew: false },
	};
	list.mockReturnValueOnce(refreshResponse.promise);

	render(
		<QueryClientProvider client={client}>
			<ThreadInfiniteList
				state="inbox"
				renderItem={(thread) => <div data-testid="thread">{thread.title}</div>}
			/>
		</QueryClientProvider>
	);
	const renderedTitles = () => screen.getAllByTestId("thread").map((row) => row.textContent);
	let refresh: Promise<void>;
	act(() => {
		applyMoveThreadOptimisticUpdates(client, {
			sourceState: "inbox",
			destinationState: "trash",
			thread: deleted,
		});
		refresh = client.invalidateQueries({ queryKey });
	});
	expect(screen.queryByText("목록을 갱신하는 중…")).toBeNull();
	expect(screen.queryByRole("button", { name: "새 글 보기" })).toBeNull();
	await waitFor(() => expect(screen.queryByText(deleted.title)).toBeNull());
	await act(async () => {
		refreshResponse.resolve(visiblePage);
		await refresh;
	});
	await screen.findByText(remaining.at(-1)?.title ?? "");
	expect(screen.queryByRole("button", { name: "새 글 보기" })).toBeNull();
	expect(screen.queryByText("새 글이 도착했어요")).toBeNull();

	list.mockResolvedValueOnce({ ...visiblePage, inboxWindow: { ...inboxWindow, hasNew: true } });
	await act(() => client.invalidateQueries({ queryKey }));
	const showNew = await screen.findByRole("button", { name: "새 글 보기" });
	expect(screen.getByRole("status").textContent).toBe("새 글이 도착했어요");
	expect(list).toHaveBeenLastCalledWith(
		expect.objectContaining({ inboxViewCursor: inboxWindow.cursor }),
		expect.anything()
	);
	expect(renderedTitles()).toEqual(remaining.map((row) => row.title));

	list.mockReturnValueOnce(failedRequest.promise);
	const callsBeforeRefresh = list.mock.calls.length;
	fireEvent.click(showNew);
	await waitFor(() => expect(showNew).toHaveProperty("disabled", true));
	fireEvent.click(showNew);
	expect(list).toHaveBeenCalledTimes(callsBeforeRefresh + 1);
	await act(async () => {
		failedRequest.reject(new Error("새 글 조회 실패"));
	});
	await waitFor(() => expect(showNew).toHaveProperty("disabled", false));
	expect(screen.getByRole("status").textContent).toBe("새 글이 도착했어요");
	expect(renderedTitles()).toEqual(remaining.map((row) => row.title));

	list.mockResolvedValueOnce(latestPage);
	fireEvent.click(showNew);
	await screen.findByText(incoming.title);
	expect(list).toHaveBeenLastCalledWith(
		expect.objectContaining({ inboxViewCursor: undefined }),
		expect.anything()
	);
	expect(renderedTitles().slice(0, 2)).toEqual([incoming.title, remaining[0].title]);
	expect(screen.queryByRole("button", { name: "새 글 보기" })).toBeNull();
	expect(screen.queryByText("새 글이 도착했어요")).toBeNull();
	client.clear();
});

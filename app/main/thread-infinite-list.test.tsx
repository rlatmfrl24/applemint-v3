import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type ThreadPage, threadListQueryKey } from "@/lib/thread-list-contract";
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

function createListClient(items: ThreadPage["items"] = []) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
	});
	queryClient.setQueryData(threadListQueryKey("inbox"), {
		pages: [{ items, nextCursor: null }],
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

it("기존 항목 위에 갱신 로더를 표시하고 새 결과를 받으면 숨긴다", async () => {
	const existing = {
		id: "1",
		type: "normal",
		url: "https://example.com/1",
		title: "기존 항목",
		description: null,
		host: "example.com",
		state: "inbox" as const,
		created_at: "2026-11-23T00:00:00Z",
		captured_at: "2026-11-23T00:00:00Z",
		state_changed_at: "2026-11-23T00:00:00Z",
		media_metadata: null,
	};
	const incoming = { ...existing, id: "2", title: "신규 항목", url: "https://example.com/2" };
	const client = createListClient([existing]);
	const response = Promise.withResolvers<ThreadPage>();
	const loaderText = "목록을 갱신하는 중…";
	expect(renderList(client)).not.toContain(loaderText);

	const refresh = client.fetchInfiniteQuery({
		queryKey: threadListQueryKey("inbox"),
		initialPageParam: undefined,
		queryFn: () => response.promise,
		staleTime: 0,
	});
	try {
		const html = renderList(client);
		expect(html).toContain(loaderText);
		expect(html).toContain(existing.title);
		expect(html.indexOf(loaderText)).toBeLessThan(html.indexOf(existing.title));
	} finally {
		response.resolve({ items: [incoming, existing], nextCursor: null });
		await refresh;
	}

	const refreshed = renderList(client);
	expect(refreshed).toContain(incoming.title);
	expect(refreshed).not.toContain(loaderText);
});

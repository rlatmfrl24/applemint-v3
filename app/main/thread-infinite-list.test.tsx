import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { threadListQueryKey } from "@/lib/thread-list-contract";
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

function renderEmptyList(emptyState?: React.ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
	});
	queryClient.setQueryData(threadListQueryKey("inbox"), {
		pages: [{ items: [], nextCursor: null }],
		pageParams: [undefined],
	});

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
		const html = renderEmptyList(<div data-testid="custom-empty">Inbox timer</div>);

		expect(html).toContain('data-testid="custom-empty"');
		expect(html).not.toContain("No data to display");
	});

	it("빈 상태를 제공하지 않은 기존 화면은 기본 No Data UI를 유지한다", () => {
		expect(renderEmptyList()).toContain("No data to display");
	});
});

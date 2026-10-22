// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bookmarkJobSchema } from "@/contracts/bookmark.schema";
import { BookmarkJobs } from "./bookmark-jobs";

const { api } = vi.hoisted(() => ({
	api: { bookmarkImport: { details: { query: vi.fn() }, resume: { mutate: vi.fn() } } },
}));
vi.mock("@/trpc/client", () => ({ useTRPCClient: () => api }));
afterEach(cleanup);
it.each([
	["decision", "ai_budget", "AI 예산 대기"],
	["confirm", "confirmation", "의심 재확인 대기"],
	["media", "host", "호스트 요청 간격·접근 제한 대기"],
])("shows %s phase and the actual waiting time", async (phase, waitingReason, label) => {
	const id = "11111111-1111-4111-8111-111111111111";
	const job = bookmarkJobSchema.parse({
		id,
		kind: "check",
		state: "retry",
		scope: { origin: "automatic" },
		progress: { unknownCount: 2, aiPendingCount: 1 },
		total: 3,
		completed: 1,
		failed: 0,
		attempts: 1,
		available_at: "2026-11-01T00:00:00Z",
		lease_token: null,
		lease_expires_at: null,
		error: null,
		created_at: "2026-10-22T00:00:00Z",
		updated_at: "2026-10-22T00:00:00Z",
	});
	api.bookmarkImport.details.query.mockResolvedValue({
		items: [
			{
				bookmark_id: id,
				state: "waiting",
				phase,
				waitingReason,
				error: null,
				available_at: "2026-11-01T00:00:00Z",
				bookmarks: { url: "https://example.com", title: "Waiting bookmark" },
			},
		],
		total: 1,
	});
	const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={cache}>
			<BookmarkJobs jobs={[job]} />
		</QueryClientProvider>
	);
	fireEvent.click(screen.getByText("실패·재검사·미처리 항목 확인"));
	expect(await screen.findByText(new RegExp(label))).toBeTruthy();
	expect(screen.queryByText(/1분 뒤/)).toBeNull();
	expect(screen.getByText(/링크 검사 · 자동/)).toBeTruthy();
});

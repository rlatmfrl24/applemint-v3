// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bookmarkJobSchema } from "@/contracts/bookmark.schema";
import { BookmarkJobs } from "./bookmark-jobs";

const { api } = vi.hoisted(() => ({
	api: {
		bookmarkImport: { details: { query: vi.fn() }, resume: { mutate: vi.fn() } },
		bookmarkAI: { closeScheduledJob: { mutate: vi.fn() } },
	},
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

it("requires confirmation to close a scheduled round and removes resume once closed", async () => {
	const id = "11111111-1111-4111-8111-111111111111";
	const date = "2026-11-19T00:00:00Z";
	const job = bookmarkJobSchema.parse({
		id,
		kind: "classify",
		state: "paused",
		scope: { origin: "scheduled-classify", scheduledDate: "2026-11-19" },
		progress: { usageUncertain: true },
		total: 2,
		completed: 1,
		failed: 0,
		attempts: 1,
		available_at: date,
		lease_token: null,
		lease_expires_at: null,
		error: "AI 응답 확인 실패",
		created_at: date,
		updated_at: date,
	});
	const closed = {
		...job,
		state: "partial" as const,
		progress: { ...job.progress, closedAt: date },
	};
	api.bookmarkAI.closeScheduledJob.mutate.mockResolvedValue(closed);
	const cache = new QueryClient();
	const list = (round: typeof job) => (
		<QueryClientProvider client={cache}>
			<BookmarkJobs jobs={[round]} />
		</QueryClientProvider>
	);
	const view = render(list(job));
	expect(screen.getByText(/정기 재분류/)).toBeTruthy();
	expect(screen.getByText(/재호출될 수 있습니다/)).toBeTruthy();
	expect(screen.getByRole("link", { name: "컬렉션 제안" }).getAttribute("href")).toBe(
		"/main/bookmarks/review?group=classify"
	);
	fireEvent.click(screen.getByRole("button", { name: "회차 종료" }));
	const dialog = screen.getByRole("alertdialog");
	expect(api.bookmarkAI.closeScheduledJob.mutate).not.toHaveBeenCalled();
	fireEvent.click(within(dialog).getByRole("button", { name: "종료 확인" }));
	await waitFor(() =>
		expect(api.bookmarkAI.closeScheduledJob.mutate).toHaveBeenCalledExactlyOnceWith({
			id,
			confirmed: true,
		})
	);
	view.rerender(list(closed));
	expect(screen.getByText(/종료됨/)).toBeTruthy();
	expect(screen.queryByRole("button", { name: "같은 작업 재개" })).toBeNull();
	expect(screen.queryByRole("button", { name: "회차 종료" })).toBeNull();
});

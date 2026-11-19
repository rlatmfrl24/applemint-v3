// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookmarkScheduledClassificationSettings } from "./bookmark-scheduled-classification-settings";

const { api, toast } = vi.hoisted(() => ({
	api: {
		bookmarkAI: {
			scheduledSettings: { query: vi.fn() },
			updateScheduledSettings: { mutate: vi.fn() },
		},
	},
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/trpc/client", () => ({ useTRPCClient: () => api }));
vi.mock("sonner", () => ({ toast }));
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

const defaults = {
	enabled: false,
	dailyLimit: 100,
	timeZone: "Asia/Seoul",
	hour: 9,
	startedAt: null,
	nextEligibleAt: null,
	status: "disabled",
	lastJob: null,
};

function showSettings() {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<BookmarkScheduledClassificationSettings />
		</QueryClientProvider>
	);
}

it("defaults to disabled at 100, constrains the range, and preserves input after a failed save", async () => {
	api.bookmarkAI.scheduledSettings.query.mockResolvedValue(defaults);
	api.bookmarkAI.updateScheduledSettings.mutate.mockRejectedValue(new Error("설정 저장 실패"));
	showSettings();
	const enabled = (await screen.findByRole("checkbox", {
		name: "매일 재분류",
	})) as HTMLInputElement;
	const limit = screen.getByRole("spinbutton", { name: "회차당 북마크 수" }) as HTMLInputElement;
	expect(enabled.checked).toBe(false);
	expect(limit.value).toBe("100");
	expect(limit.min).toBe("1");
	expect(limit.max).toBe("500");
	fireEvent.click(enabled);
	fireEvent.change(limit, { target: { value: "25" } });
	fireEvent.click(screen.getByRole("button", { name: "정기 재분류 설정 저장" }));
	await waitFor(() => expect(toast.error).toHaveBeenCalledWith("설정 저장 실패"));
	expect(api.bookmarkAI.updateScheduledSettings.mutate).toHaveBeenCalledWith({
		enabled: true,
		dailyLimit: 25,
	});
	expect(enabled.checked).toBe(true);
	expect(limit.value).toBe("25");
});

it("shows the KST cutoff, next run, and a link to the most recent round", async () => {
	api.bookmarkAI.scheduledSettings.query.mockResolvedValue({
		...defaults,
		enabled: true,
		startedAt: "2026-11-19T01:15:00+00:00",
		nextEligibleAt: "2026-11-20T00:00:00+00:00",
		status: "waiting",
		lastJob: { id: "11111111-1111-4111-8111-111111111111", scope: { scheduledDate: "2026-11-19" } },
	});
	showSettings();
	expect(await screen.findByText("다음 회차 대기")).toBeTruthy();
	expect(screen.getByText("최초 활성화")).toBeTruthy();
	expect(screen.getByText("다음 실행 가능 시각")).toBeTruthy();
	expect(screen.getByText(/10:15/)).toBeTruthy();
	expect(screen.getByText(/09:00 KST$/)).toBeTruthy();
	expect(screen.getByRole("link", { name: "최근 회차 2026-11-19" }).getAttribute("href")).toBe(
		"/main/bookmarks/activity#bookmark-job-11111111-1111-4111-8111-111111111111"
	);
});

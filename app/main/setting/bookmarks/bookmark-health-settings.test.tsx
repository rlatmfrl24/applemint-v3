// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BookmarkHealthSettingsPanel } from "./bookmark-health-settings";

const { api } = vi.hoisted(() => ({
	api: { bookmarkCheck: { settings: { query: vi.fn() }, updateSettings: { mutate: vi.fn() } } },
}));
vi.mock("@/trpc/client", () => ({ useTRPCClient: () => api }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
it("settings default is off with 500 per day and disable preserves in-flight results", async () => {
	const settings = {
		enabled: false,
		dailyLimit: 500,
		timeZone: "Asia/Seoul",
		hour: 9,
		workerConfigured: false,
		lastAutomaticJob: null,
	};
	api.bookmarkCheck.settings.query.mockResolvedValue(settings);
	api.bookmarkCheck.updateSettings.mutate.mockResolvedValue({ ...settings, enabled: true });
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<BookmarkHealthSettingsPanel />
		</QueryClientProvider>
	);
	const enabled = await screen.findByRole("checkbox", { name: "매일 자동 점검" });
	expect((enabled as HTMLInputElement).checked).toBe(false);
	expect(screen.getByText(/원문 발췌가 기존 AI 공급자로 전송/)).toBeTruthy();
	expect(
		(screen.getByRole("spinbutton", { name: "하루 점검 개수" }) as HTMLInputElement).value
	).toBe("500");
	fireEvent.click(enabled);
	fireEvent.click(screen.getByRole("button", { name: "자동 검사 설정 저장" }));
	await waitFor(() =>
		expect(api.bookmarkCheck.updateSettings.mutate).toHaveBeenCalledWith({
			enabled: true,
			dailyLimit: 500,
		})
	);
	expect(screen.getByText(/이미 시작한 검사의 결과와 정산은 보존/)).toBeTruthy();
});

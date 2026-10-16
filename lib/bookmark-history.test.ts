import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("tracks application entries without removing router state or adding history entries", async () => {
	vi.resetModules();
	const initial = { __NA: true, routerTree: { route: "main" } };
	const history = {
		state: initial as Record<string, unknown>,
		pushState: vi.fn((state: Record<string, unknown>) => {
			history.state = state;
		}),
		replaceState: vi.fn((state: Record<string, unknown>) => {
			history.state = state;
		}),
	};
	const push = history.pushState;
	const addEventListener = vi.fn();
	vi.stubGlobal("window", { history, addEventListener });
	const { trackBookmarkHistory, bookmarkHistoryPosition } = await import("./bookmark-history");
	trackBookmarkHistory();
	trackBookmarkHistory();
	expect(addEventListener).toHaveBeenCalledTimes(1);
	expect(push).not.toHaveBeenCalled();
	expect(history.state).toMatchObject(initial);
	expect(bookmarkHistoryPosition()).toBe(0);
	const previous = history.state;
	history.pushState({ __NA: true, routerTree: { route: "bookmarks" } });
	expect(history.state).toMatchObject({ __NA: true, routerTree: { route: "bookmarks" } });
	expect(bookmarkHistoryPosition()).toBe(1);
	history.replaceState({ __NA: true, routerTree: { search: "changed" } });
	expect(bookmarkHistoryPosition()).toBe(1);
	history.state = previous;
	expect(bookmarkHistoryPosition()).toBe(0);
	history.pushState({ __NA: true, routerTree: { route: "quick" } });
	expect(bookmarkHistoryPosition()).toBe(1);
});

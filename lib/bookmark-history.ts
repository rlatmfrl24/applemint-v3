const positionKey = "__applemintHistoryPosition";
let tracking = false;
let guard: ((event: PopStateEvent) => void) | null = null;

export function guardBookmarkHistory(listener: (event: PopStateEvent) => void) {
	guard = listener;
	return () => {
		if (guard === listener) guard = null;
	};
}

export function bookmarkHistoryPosition(): number {
	const navigation = (window as Window & { navigation?: { currentEntry?: { index: number } } })
		.navigation;
	return navigation?.currentEntry?.index ?? window.history.state?.[positionKey] ?? 0;
}

export function trackBookmarkHistory() {
	if (tracking) return;
	tracking = true;
	const history = window.history;
	// Window is the event target: this must register before Next's own popstate listener.
	window.addEventListener("popstate", (event) => guard?.(event), true);
	// Start in the shared layout so Back/Forward destinations are known before opening an editor.
	for (const method of ["pushState", "replaceState"] as const) {
		const original = history[method].bind(history);
		history[method] = (state, unused, url) =>
			original(
				{ ...state, [positionKey]: bookmarkHistoryPosition() + (method === "pushState" ? 1 : 0) },
				unused,
				url
			);
	}
	history.replaceState(history.state, "");
}

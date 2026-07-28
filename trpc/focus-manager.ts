type FocusHandler = (focused?: boolean) => void;

export const setupBrowserFocusListener = (handleFocus: FocusHandler) => {
	if (typeof window === "undefined" || !window.addEventListener) {
		return;
	}

	const notifyFocusManager = () => handleFocus();
	window.addEventListener("visibilitychange", notifyFocusManager, false);
	window.addEventListener("focus", notifyFocusManager, false);

	return () => {
		window.removeEventListener("visibilitychange", notifyFocusManager);
		window.removeEventListener("focus", notifyFocusManager);
	};
};

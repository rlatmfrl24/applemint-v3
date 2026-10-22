import { useEffect, useRef, useState } from "react";

const easing = "cubic-bezier(0.23, 1, 0.32, 1)";

export function useBookmarkDialogMotion<T extends HTMLElement>(
	close: () => void,
	openedAt?: number
) {
	const [element, setElement] = useState<T | null>(null);
	const overlay = useRef<HTMLDivElement>(null);
	const animations = useRef<Animation[]>([]);
	const closing = useRef(false);

	useEffect(() => {
		if (!element?.animate) return;
		const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
		const animation = element.animate(
			[
				{ opacity: 0, ...(!reduce && { transform: "scale(0.96)" }) },
				{ opacity: 1, ...(!reduce && { transform: "scale(1)" }) },
			],
			{ duration: 250, easing, fill: "both" }
		);
		// Continue the same entrance when the lazy form replaces the loading dialog.
		animation.currentTime =
			openedAt === undefined ? 0 : Math.min(performance.now() - openedAt, 250);
		const backdrop = (overlay.current ?? element).animate([{ opacity: 0 }, { opacity: 1 }], {
			duration: 250,
			easing,
			fill: "both",
			...(!overlay.current && { pseudoElement: "::backdrop" }),
		});
		backdrop.currentTime = animation.currentTime;
		animations.current = [animation, backdrop];
		return () => {
			for (const current of animations.current) current.cancel();
		};
	}, [element, openedAt]);

	function dismiss() {
		if (closing.current) return;
		closing.current = true;
		if (!element?.animate) return close();
		const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
		const style = getComputedStyle(element);
		const from = { opacity: style.opacity, ...(!reduce && { transform: style.transform }) };
		const backdropElement = overlay.current ?? element;
		const backdropOpacity = getComputedStyle(
			backdropElement,
			overlay.current ? null : "::backdrop"
		).opacity;
		for (const current of animations.current) current.cancel();
		element.inert = true;
		const animation = element.animate(
			[from, { opacity: 0, ...(!reduce && { transform: "scale(0.96)" }) }],
			{ duration: 200, easing, fill: "forwards" }
		);
		const backdrop = backdropElement.animate([{ opacity: backdropOpacity }, { opacity: 0 }], {
			duration: 200,
			easing,
			fill: "forwards",
			...(!overlay.current && { pseudoElement: "::backdrop" }),
		});
		animations.current = [animation, backdrop];
		void animation.finished.then(close, close);
	}

	return { content: setElement, element, overlay, dismiss };
}

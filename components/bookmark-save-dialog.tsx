"use client";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { BookmarkAvailability } from "@/lib/bookmark-links";
import type { Source } from "./bookmark-save-form";
import { useBookmarkDialogMotion } from "./use-bookmark-dialog-motion";

const BookmarkSaveForm = lazy(() => import("./bookmark-save-form"));
function SaveLoading({ close, openedAt }: { close: () => void; openedAt: number }) {
	const {
		content,
		element: dialog,
		dismiss,
	} = useBookmarkDialogMotion<HTMLDialogElement>(close, openedAt);
	const title = useId();
	useEffect(() => {
		dialog?.showModal();
		return () => dialog?.close();
	}, [dialog]);
	return (
		<dialog
			ref={content}
			aria-labelledby={title}
			aria-busy="true"
			onCancel={(event) => {
				event.preventDefault();
				dismiss();
			}}
			className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg space-y-4 rounded-lg border bg-background p-6 text-foreground shadow-lg backdrop:bg-black/80 max-sm:top-auto max-sm:mb-0 max-sm:w-full max-sm:rounded-t-xl max-sm:rounded-b-none max-sm:p-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]"
		>
			<h2 id={title} className="m-0 border-0 p-0 font-semibold text-lg">
				북마크 저장
			</h2>
			<p role="status" className="text-muted-foreground text-sm">
				저장 화면을 불러오는 중…
			</p>
			<div aria-hidden="true" className="space-y-3">
				<div className="h-10 rounded-md bg-muted" />
				<div className="h-10 rounded-md bg-muted" />
				<div className="h-10 rounded-md bg-muted" />
			</div>
			<Button variant="outline" className="min-h-11 max-sm:w-full" onClick={dismiss}>
				취소
			</Button>
		</dialog>
	);
}

export function BookmarkSaveDialog({
	source,
	recommendationId,
	availability = "available",
}: {
	source: Source;
	recommendationId?: string;
	availability?: BookmarkAvailability;
}) {
	const [openedAt, setOpenedAt] = useState<number | null>(null);
	const [ready, setReady] = useState(false);
	const [tooltipDismissed, setTooltipDismissed] = useState(false);
	const tooltipId = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const saved = availability === "saved";
	const BookmarkIcon = saved ? BookmarkCheck : Bookmark;
	useEffect(() => setReady(true), []);
	return (
		<>
			<span className="group/bookmark-trigger relative inline-flex">
				<Button
					ref={trigger}
					variant="outline"
					size="sm"
					className="aria-disabled:cursor-default aria-disabled:opacity-55"
					disabled={!ready || availability === "checking"}
					aria-disabled={saved || undefined}
					aria-describedby={saved ? tooltipId : undefined}
					onMouseEnter={() => setTooltipDismissed(false)}
					onFocus={() => setTooltipDismissed(false)}
					onKeyDown={(event) => {
						if (saved && event.key === "Escape") setTooltipDismissed(true);
					}}
					onClick={() => {
						if (!saved) setOpenedAt(performance.now());
					}}
				>
					<BookmarkIcon aria-hidden="true" className="mr-1 size-3.5" />
					{recommendationId ? "Review & Save" : "Bookmark"}
				</Button>
				{saved && (
					<span
						id={tooltipId}
						role="tooltip"
						hidden={tooltipDismissed}
						className="invisible absolute bottom-full left-0 z-20 pb-1 group-focus-within/bookmark-trigger:visible group-hover/bookmark-trigger:visible"
					>
						<span className="block whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-sm">
							이미 북마크에 저장됨
						</span>
					</span>
				)}
			</span>
			{openedAt !== null && (
				<Suspense
					fallback={
						<SaveLoading
							openedAt={openedAt}
							close={() => {
								setOpenedAt(null);
								requestAnimationFrame(() => trigger.current?.focus());
							}}
						/>
					}
				>
					<BookmarkSaveForm
						source={source}
						recommendationId={recommendationId}
						openedAt={openedAt}
						close={() => setOpenedAt(null)}
						returnFocus={() => trigger.current?.focus()}
					/>
				</Suspense>
			)}
		</>
	);
}

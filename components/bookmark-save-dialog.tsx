"use client";
import { Bookmark } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
			className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg space-y-4 rounded-lg border bg-background p-6 text-foreground shadow-lg backdrop:bg-black/80"
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
			<Button variant="outline" onClick={dismiss}>
				취소
			</Button>
		</dialog>
	);
}

export function BookmarkSaveDialog({
	source,
	recommendationId,
}: {
	source: Source;
	recommendationId?: string;
}) {
	const [openedAt, setOpenedAt] = useState<number | null>(null);
	const [ready, setReady] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	useEffect(() => setReady(true), []);
	return (
		<>
			<Button
				ref={trigger}
				variant="outline"
				size="sm"
				disabled={!ready}
				onClick={() => setOpenedAt(performance.now())}
			>
				<Bookmark aria-hidden="true" className="mr-1 size-3.5" />
				{recommendationId ? "Review & Save" : "Bookmark"}
			</Button>
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

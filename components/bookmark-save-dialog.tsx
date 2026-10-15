"use client";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Source } from "./bookmark-save-form";

const BookmarkSaveForm = lazy(() => import("./bookmark-save-form"));
function SaveLoading({ close }: { close: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const title = useId();
	useEffect(() => {
		const element = dialog.current;
		element?.showModal();
		return () => element?.close();
	}, []);
	return (
		<dialog
			ref={dialog}
			aria-labelledby={title}
			aria-busy="true"
			onCancel={close}
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
			<Button variant="outline" onClick={close}>
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
	const [open, setOpen] = useState(false);
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
				onClick={() => setOpen(true)}
			>
				{recommendationId ? "추천 확인·저장" : "북마크 저장"}
			</Button>
			{open && (
				<Suspense
					fallback={
						<SaveLoading
							close={() => {
								setOpen(false);
								requestAnimationFrame(() => trigger.current?.focus());
							}}
						/>
					}
				>
					<BookmarkSaveForm
						source={source}
						recommendationId={recommendationId}
						close={() => setOpen(false)}
						returnFocus={() => trigger.current?.focus()}
					/>
				</Suspense>
			)}
		</>
	);
}

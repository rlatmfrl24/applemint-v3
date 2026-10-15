"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Source } from "./bookmark-save-form";

const BookmarkSaveForm = dynamic(() => import("./bookmark-save-form"), {
	loading: () => (
		<AlertDialogContent aria-busy="true">
			<AlertDialogHeader>
				<AlertDialogTitle>북마크 저장</AlertDialogTitle>
				<AlertDialogDescription>저장 화면을 불러오는 중…</AlertDialogDescription>
			</AlertDialogHeader>
			<div role="status" className="space-y-3">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
			</div>
			<AlertDialogCancel>취소</AlertDialogCancel>
		</AlertDialogContent>
	),
});

export function BookmarkSaveDialog({
	source,
	recommendationId,
}: {
	source: Source;
	recommendationId?: string;
}) {
	const [open, setOpen] = useState(false);
	const [ready, setReady] = useState(false);
	const [saving, setSaving] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	useEffect(() => setReady(true), []);
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!saving) setOpen(next);
			}}
		>
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
				<BookmarkSaveForm
					source={source}
					recommendationId={recommendationId}
					close={() => setOpen(false)}
					returnFocus={() => trigger.current?.focus()}
					onSavingChange={setSaving}
				/>
			)}
		</AlertDialog>
	);
}

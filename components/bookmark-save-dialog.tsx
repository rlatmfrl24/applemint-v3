"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Source } from "./bookmark-save-form";

const BookmarkSaveForm = dynamic(() => import("./bookmark-save-form"), {
	loading: () => (
		<p role="status" className="sr-only">
			저장 화면을 불러오는 중…
		</p>
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
				<BookmarkSaveForm
					source={source}
					recommendationId={recommendationId}
					close={() => setOpen(false)}
					returnFocus={() => trigger.current?.focus()}
				/>
			)}
		</>
	);
}

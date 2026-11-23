"use client";

import { Link2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getImgurEmbedTarget } from "@/lib/imgur-embed";
import type { ThreadItemType } from "@/lib/type-defs";
import { ImgurThreadContent } from "./imgur-embed-preview";
import { ThreadCardTitle } from "./thread-card-title";
import { YouTubeThreadContent } from "./youtube-thread-content";

function DefaultThreadContent({
	thread,
	onOpen,
	meta,
	showDescription,
}: {
	thread: ThreadItemType;
	onOpen: () => void;
	meta?: React.ReactNode;
	showDescription: boolean;
}) {
	return (
		<div className="flex items-start gap-3" data-testid="default-thread-content">
			<div className="min-w-0 flex-1 space-y-1.5">
				<div className="flex flex-wrap items-center gap-1.5">
					<Badge variant="secondary" className="px-1.5 py-0 text-[11px] capitalize">
						{thread.type}
					</Badge>
					{thread.host ? (
						<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
							{thread.host}
						</Badge>
					) : null}
					{meta}
				</div>
				<ThreadCardTitle
					title={thread.title || "Untitled"}
					onOpen={onOpen}
					className="py-1 leading-6"
				/>
				<div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
					<Link2 className="size-3 shrink-0" />
					<span className="truncate">{thread.url}</span>
				</div>
				{showDescription && thread.description ? (
					<p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
						{thread.description}
					</p>
				) : null}
			</div>
		</div>
	);
}

export function ThreadCard({
	thread,
	actions,
	meta,
	showDescription = true,
}: {
	thread: ThreadItemType;
	actions?: React.ReactNode;
	meta?: React.ReactNode;
	showDescription?: boolean;
}) {
	const [isImgurPreviewExpanded, setIsImgurPreviewExpanded] = useState(false);
	const imgurEmbedTarget = useMemo(
		() => (thread.type === "imgur" ? getImgurEmbedTarget(thread.url) : null),
		[thread.type, thread.url]
	);
	const handleOpen = useCallback(() => {
		window.open(thread.url, "_blank", "noopener,noreferrer");
	}, [thread.url]);

	return (
		<Card
			className="relative isolate w-full border-zinc-200/80 shadow-none transition-colors duration-150 hover:border-zinc-400/60 hover:bg-zinc-50 motion-reduce:transition-none dark:border-zinc-800 dark:hover:border-zinc-600/90 dark:hover:bg-zinc-900/60"
			data-testid="thread-card"
			data-thread-url={thread.url}
		>
			<CardContent className="flex flex-col gap-3 p-3">
				{thread.type === "youtube" ? (
					<YouTubeThreadContent thread={thread} onOpen={handleOpen} meta={meta} />
				) : imgurEmbedTarget ? (
					<ImgurThreadContent
						thread={thread}
						onOpen={handleOpen}
						previewOpen={isImgurPreviewExpanded}
						onPreviewOpenChange={setIsImgurPreviewExpanded}
						meta={meta}
					/>
				) : (
					<DefaultThreadContent
						thread={thread}
						onOpen={handleOpen}
						meta={meta}
						showDescription={showDescription}
					/>
				)}
				{actions ? (
					<div className="relative z-10 flex w-fit max-w-full flex-wrap items-center gap-1.5">
						{actions}
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

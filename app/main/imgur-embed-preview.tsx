"use client";

import { ChevronUp, Images, Link2, Loader2, Maximize2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getImgurEmbedResizeHeight, type ImgurEmbedTarget } from "@/lib/imgur-embed";
import type { ThreadItemType } from "@/lib/type-defs";
import { cn } from "@/lib/utils";
import { MEDIA_CARD_LAYOUT_CLASS } from "./media-card-layout";

function getThreadTitle(thread: ThreadItemType) {
	return thread.title?.trim() || "Imgur 이미지";
}

export function ImgurThreadContent({
	thread,
	target,
	onOpen,
	previewOpen,
	onPreviewOpenChange,
	meta,
}: {
	thread: ThreadItemType;
	target: ImgurEmbedTarget;
	onOpen: () => void;
	previewOpen: boolean;
	onPreviewOpenChange: (open: boolean) => void;
	meta?: React.ReactNode;
}) {
	const title = getThreadTitle(thread);
	const previewId = useId();

	return (
		<div
			className="space-y-3"
			data-testid="imgur-thread-content"
			data-preview-state={previewOpen ? "open" : "closed"}
		>
			<div className={MEDIA_CARD_LAYOUT_CLASS}>
				<div
					data-testid="imgur-thumbnail"
					className="group relative aspect-video w-full overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900"
				>
					<ImgurEmbedFrame target={target} title={title} variant="thumbnail" />
					<button
						type="button"
						aria-expanded={previewOpen}
						aria-controls={previewId}
						aria-label={`${title} 전체 미리보기`}
						onClick={() => onPreviewOpenChange(true)}
						className="absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/35 via-transparent to-transparent p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset"
					>
						<span className="inline-flex items-center rounded bg-black/75 px-2 py-1 font-medium text-[11px] text-white opacity-90 transition-opacity group-hover:opacity-100">
							<Maximize2 aria-hidden="true" className="mr-1 size-3" />
							전체 보기
						</span>
					</button>
				</div>

				<div className="flex min-w-0 flex-col gap-1.5">
					<div className="flex flex-wrap items-center gap-1.5">
						<Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
							Imgur
						</Badge>
						{thread.host ? (
							<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
								{thread.host}
							</Badge>
						) : null}
						{meta}
					</div>
					<button
						type="button"
						aria-label={`${title} Imgur에서 열기`}
						className="-mx-1 rounded-md px-1 py-0.5 text-left font-semibold text-[15px] leading-5 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 sm:text-base dark:focus-visible:ring-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
						onClick={onOpen}
						style={{
							display: "-webkit-box",
							WebkitBoxOrient: "vertical",
							WebkitLineClamp: 2,
							overflow: "hidden",
						}}
					>
						{title}
					</button>
					<div className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
						<Link2 aria-hidden="true" className="size-3 shrink-0" />
						<span className="truncate">{thread.url}</span>
					</div>
					{thread.description ? (
						<p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
							{thread.description}
						</p>
					) : null}
				</div>
			</div>

			{previewOpen ? (
				<section
					id={previewId}
					aria-label={`${title} Imgur 전체 미리보기`}
					data-testid="imgur-full-preview"
					className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
				>
					<div className="flex items-center justify-between gap-2 border-zinc-200 border-b bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
						<div className="flex min-w-0 items-center gap-2">
							<Images aria-hidden="true" className="size-4 shrink-0 text-zinc-500" />
							<span className="truncate font-medium text-xs">전체 미리보기</span>
						</div>
						<Button
							variant="ghost"
							size="sm"
							type="button"
							onClick={() => onPreviewOpenChange(false)}
						>
							<ChevronUp aria-hidden="true" className="mr-1 size-3.5" />
							미리보기 접기
						</Button>
					</div>
					<div className="max-h-[36rem] overflow-y-auto">
						<ImgurEmbedFrame target={target} title={title} variant="full" />
					</div>
				</section>
			) : null}
		</div>
	);
}

export function ImgurEmbedFrame({
	target,
	title,
	variant = "full",
}: {
	target: ImgurEmbedTarget;
	title: string;
	variant?: "thumbnail" | "full";
}) {
	const [height, setHeight] = useState(540);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const nextHeight = getImgurEmbedResizeHeight(event, target);
			if (nextHeight) setHeight(nextHeight);
		};

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [target]);

	return (
		<div
			className={cn(
				"relative bg-zinc-100 dark:bg-zinc-950",
				variant === "thumbnail" ? "h-full min-h-0" : "min-h-80"
			)}
		>
			{loaded ? null : (
				<div
					role="status"
					className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"
				>
					<Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
					<span className={cn(variant === "thumbnail" && "sr-only")}>
						Imgur 미리보기를 불러오는 중입니다.
					</span>
				</div>
			)}
			<iframe
				data-testid="imgur-embed-frame"
				data-embed-variant={variant}
				src={target.embedUrl}
				title={`${title} Imgur 미리보기`}
				loading="lazy"
				referrerPolicy="no-referrer"
				sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
				allowFullScreen
				onLoad={() => setLoaded(true)}
				className={cn(
					"w-full border-0 bg-white transition-opacity",
					variant === "thumbnail" && "pointer-events-none min-h-[20rem]",
					loaded ? "opacity-100" : "opacity-0"
				)}
				tabIndex={variant === "thumbnail" ? -1 : undefined}
				style={{ height }}
			/>
		</div>
	);
}

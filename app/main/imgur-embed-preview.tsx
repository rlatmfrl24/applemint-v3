"use client";

import { ChevronUp, Images, Link2, Loader2, Maximize2 } from "lucide-react";
import Image from "next/image";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ThreadItemType } from "@/lib/type-defs";
import { cn } from "@/lib/utils";
import { MEDIA_CARD_LAYOUT_CLASS } from "./media-card-layout";

function getThreadTitle(thread: ThreadItemType) {
	return thread.title?.trim() || "Imgur 이미지";
}

export function ImgurThreadContent({
	thread,
	onOpen,
	previewOpen,
	onPreviewOpenChange,
	meta,
}: {
	thread: ThreadItemType;
	onOpen: () => void;
	previewOpen: boolean;
	onPreviewOpenChange: (open: boolean) => void;
	meta?: React.ReactNode;
}) {
	const title = getThreadTitle(thread);
	const previewId = useId();
	const previewToggleLabel = previewOpen ? "미리보기 접기" : "전체 보기";

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
					<ImgurPreviewImage sourceUrl={thread.url} title={title} variant="thumbnail" />
					<button
						type="button"
						aria-expanded={previewOpen}
						aria-controls={previewId}
						aria-label={`${title} ${previewToggleLabel}`}
						onClick={() => onPreviewOpenChange(!previewOpen)}
						className="absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/35 via-transparent to-transparent p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset"
					>
						<span className="inline-flex items-center rounded bg-black/75 px-2 py-1 font-medium text-[11px] text-white opacity-90 transition-opacity group-hover:opacity-100">
							{previewOpen ? (
								<ChevronUp aria-hidden="true" className="mr-1 size-3" />
							) : (
								<Maximize2 aria-hidden="true" className="mr-1 size-3" />
							)}
							{previewToggleLabel}
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
					<div className="relative h-[min(70vh,36rem)] min-h-80 bg-zinc-100 dark:bg-zinc-950">
						<ImgurPreviewImage sourceUrl={thread.url} title={title} variant="full" />
					</div>
				</section>
			) : null}
		</div>
	);
}

function ImgurPreviewImage({
	sourceUrl,
	title,
	variant,
}: {
	sourceUrl: string;
	title: string;
	variant: "thumbnail" | "full";
}) {
	const [loaded, setLoaded] = useState(false);
	const [failed, setFailed] = useState(false);
	const previewUrl = `/api/media/imgur/thumbnail?url=${encodeURIComponent(sourceUrl)}`;

	return (
		<>
			{loaded || failed ? null : (
				<div
					role="status"
					className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"
				>
					<Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
					<span className={cn(variant === "thumbnail" && "sr-only")}>
						Imgur 미리보기를 불러오는 중입니다.
					</span>
				</div>
			)}
			{failed ? (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-zinc-500 dark:text-zinc-400">
					<Images aria-hidden="true" className="size-6" />
					<span className={cn("text-xs", variant === "thumbnail" && "sr-only")}>
						Imgur 이미지를 표시하지 못했습니다.
					</span>
				</div>
			) : (
				<Image
					data-testid="imgur-preview-image"
					data-preview-variant={variant}
					src={previewUrl}
					alt={title}
					fill
					unoptimized
					loading="lazy"
					sizes={variant === "thumbnail" ? "(min-width: 640px) 17rem, 100vw" : "100vw"}
					onLoad={() => setLoaded(true)}
					onError={() => setFailed(true)}
					className={cn(
						"transition-opacity",
						variant === "thumbnail" ? "object-cover" : "object-contain",
						loaded ? "opacity-100" : "opacity-0"
					)}
				/>
			)}
		</>
	);
}

"use client";

import { CirclePlay, ImageOff, Link2, Radio } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { getAllowedYouTubeThumbnailUrl } from "@/lib/media-preview";
import type { ThreadItemType } from "@/lib/type-defs";

type YouTubeCardStatus = "pending" | "ready" | "failed" | "unavailable" | "unsupported" | "legacy";

const STATUS_FALLBACK_TITLES: Record<YouTubeCardStatus, string> = {
	pending: "YouTube 영상 정보를 확인하는 중",
	ready: "YouTube 영상",
	failed: "YouTube 정보를 불러오지 못한 영상",
	unavailable: "확인할 수 없는 YouTube 영상",
	unsupported: "지원하지 않는 YouTube 링크",
	legacy: "YouTube 영상",
};

const STATUS_MESSAGES: Partial<Record<YouTubeCardStatus, string>> = {
	failed: "영상 정보를 불러오지 못했습니다.",
	unavailable: "현재 확인할 수 있는 영상 정보가 없습니다.",
	unsupported: "이 YouTube URL 형식은 영상 메타데이터를 지원하지 않습니다.",
	legacy: "아직 수집된 영상 정보가 없습니다.",
};

const YOUTUBE_CARD_LAYOUT_CLASS =
	"grid grid-cols-1 items-start gap-2.5 sm:grid-cols-[minmax(14rem,17rem)_minmax(0,1fr)]";

export function formatYouTubeDuration(seconds: number | null | undefined) {
	if (!Number.isSafeInteger(seconds) || (seconds ?? -1) < 0) return null;

	const totalSeconds = seconds as number;
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const remainingSeconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
	}
	return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getMeaningfulThreadTitle(thread: ThreadItemType) {
	const title = thread.title?.trim();
	if (!title || title === thread.url.trim() || title.toLowerCase() === "untitled") return null;
	return title;
}

function getYouTubeCardModel(thread: ThreadItemType) {
	const metadata = thread.media_metadata?.provider === "youtube" ? thread.media_metadata : null;
	const status: YouTubeCardStatus = metadata?.status ?? "legacy";
	const officialTitle = metadata?.title?.trim() || null;
	const sourceTitle = getMeaningfulThreadTitle(thread);
	const title = officialTitle ?? sourceTitle ?? STATUS_FALLBACK_TITLES[status];
	const sourceContext =
		officialTitle && sourceTitle && officialTitle !== sourceTitle ? sourceTitle : null;

	return {
		metadata,
		status,
		title,
		sourceContext,
		thumbnailUrl: getAllowedYouTubeThumbnailUrl(metadata?.thumbnail_url),
		duration:
			status === "ready" && metadata?.live_status !== "live" && metadata?.live_status !== "upcoming"
				? formatYouTubeDuration(metadata?.duration_seconds)
				: null,
	};
}

function YouTubeThumbnail({
	src,
	title,
	duration,
}: {
	src: string | null;
	title: string;
	duration: string | null;
}) {
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const hasImageError = failedSrc === src;

	return (
		<div className="relative aspect-video w-full overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900">
			{src && !hasImageError ? (
				<Image
					src={src}
					alt={`${title} 썸네일`}
					fill
					sizes="(min-width: 640px) 17rem, 100vw"
					className="object-cover"
					onError={() => setFailedSrc(src)}
				/>
			) : (
				<div
					role="img"
					aria-label={`${title} 썸네일 없음`}
					className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-zinc-400 dark:text-zinc-600"
				>
					<ImageOff aria-hidden="true" className="size-7" />
					<span className="text-xs">썸네일 없음</span>
				</div>
			)}
			{duration ? (
				<span className="absolute right-1.5 bottom-1.5 rounded bg-black/85 px-1.5 py-0.5 font-medium text-[11px] text-white">
					{duration}
				</span>
			) : null}
		</div>
	);
}

function YouTubePendingContent({
	thread,
	onOpen,
	meta,
}: {
	thread: ThreadItemType;
	onOpen: () => void;
	meta?: React.ReactNode;
}) {
	const title = getMeaningfulThreadTitle(thread) ?? STATUS_FALLBACK_TITLES.pending;

	return (
		<div
			role="status"
			aria-label="YouTube 영상 정보를 불러오는 중"
			data-media-status="pending"
			className={YOUTUBE_CARD_LAYOUT_CLASS}
		>
			<div className="aspect-video w-full animate-pulse rounded-md bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-900" />
			<div className="flex min-w-0 flex-col gap-1.5">
				<div className="flex flex-wrap items-center gap-1">
					<Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
						YouTube
					</Badge>
					{thread.host ? (
						<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
							{thread.host}
						</Badge>
					) : null}
					<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
						정보 확인 중
					</Badge>
					{meta}
				</div>
				<button
					type="button"
					aria-label={`${title} YouTube에서 열기`}
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
				<div className="h-3.5 w-2/5 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-900" />
			</div>
		</div>
	);
}

export function YouTubeThreadContent({
	thread,
	onOpen,
	meta,
}: {
	thread: ThreadItemType;
	onOpen: () => void;
	meta?: React.ReactNode;
}) {
	const model = getYouTubeCardModel(thread);
	if (model.status === "pending") {
		return <YouTubePendingContent thread={thread} onOpen={onOpen} meta={meta} />;
	}

	const message = STATUS_MESSAGES[model.status];
	const liveStatus = model.metadata?.live_status;

	return (
		<div
			data-testid="youtube-thread-content"
			data-media-status={model.status}
			className={YOUTUBE_CARD_LAYOUT_CLASS}
		>
			<YouTubeThumbnail src={model.thumbnailUrl} title={model.title} duration={model.duration} />
			<div className="flex min-w-0 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-1">
					<Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
						YouTube
					</Badge>
					{thread.host ? (
						<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
							{thread.host}
						</Badge>
					) : null}
					{liveStatus === "live" ? (
						<Badge variant="destructive" className="px-1.5 py-0 text-[11px]">
							<Radio aria-hidden="true" className="mr-1 size-3" />
							LIVE
						</Badge>
					) : null}
					{liveStatus === "upcoming" ? (
						<Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
							예정
						</Badge>
					) : null}
					{model.metadata?.media_kind === "short" ? (
						<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
							Shorts
						</Badge>
					) : null}
					{model.status === "failed" ? (
						<Badge variant="destructive" className="px-1.5 py-0 text-[11px]">
							불러오기 실패
						</Badge>
					) : null}
					{model.status === "unavailable" ? (
						<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
							영상 정보 없음
						</Badge>
					) : null}
					{model.status === "unsupported" ? (
						<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
							지원하지 않는 링크
						</Badge>
					) : null}
					{model.status === "legacy" ? (
						<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
							기본 정보
						</Badge>
					) : null}
					{meta}
				</div>
				<button
					type="button"
					aria-label={`${model.title} YouTube에서 열기`}
					className="-mx-1 rounded-md px-1 py-0.5 text-left font-semibold text-[15px] leading-5 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 sm:text-base dark:focus-visible:ring-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
					onClick={onOpen}
					style={{
						display: "-webkit-box",
						WebkitBoxOrient: "vertical",
						WebkitLineClamp: 2,
						overflow: "hidden",
					}}
				>
					{model.title}
				</button>
				{model.metadata?.channel_title ? (
					<div className="flex min-w-0 items-center gap-1 text-xs text-zinc-600 leading-4 dark:text-zinc-300">
						<CirclePlay aria-hidden="true" className="size-3.5 shrink-0" />
						<span className="truncate">{model.metadata.channel_title}</span>
					</div>
				) : null}
				{model.sourceContext ? (
					<p className="truncate text-[11px] text-zinc-500 leading-4 dark:text-zinc-400">
						수집 문맥: {model.sourceContext}
					</p>
				) : null}
				{message ? (
					<p role="status" className="text-xs text-zinc-600 leading-4 dark:text-zinc-300">
						{message}
					</p>
				) : null}
				<div
					data-testid="youtube-thread-footer"
					className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-zinc-500 leading-4 dark:text-zinc-400"
				>
					<Link2 aria-hidden="true" className="size-3 shrink-0" />
					<span className="truncate">{thread.url}</span>
				</div>
			</div>
		</div>
	);
}

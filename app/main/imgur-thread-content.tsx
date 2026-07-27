"use client";

import { ExternalLink, ImageOff, Images, Link2, Play, X } from "lucide-react";
import Image from "next/image";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import { getAllowedMediaUrl, isGifMediaUrl, isVideoMediaUrl } from "@/lib/media-preview";
import type { ThreadItemType } from "@/lib/type-defs";
import { cn } from "@/lib/utils";

type ImgurCardStatus = "pending" | "ready" | "failed" | "unavailable" | "unsupported" | "legacy";

interface ImgurCardModel {
	status: ImgurCardStatus;
	title: string;
	sourceContext: string | null;
	mediaKind: NonNullable<ThreadItemType["media_metadata"]>["media_kind"];
	mediaCount: number | null;
	previewUrls: string[];
}

const STATUS_FALLBACK_TITLES: Record<Exclude<ImgurCardStatus, "ready">, string> = {
	pending: "Imgur 정보를 확인하는 중",
	failed: "Imgur 정보를 불러오지 못한 항목",
	unavailable: "확인할 수 없는 Imgur 항목",
	unsupported: "지원하지 않는 Imgur 링크",
	legacy: "Imgur 항목",
};

const STATUS_MESSAGES: Partial<Record<ImgurCardStatus, string>> = {
	failed: "Imgur 정보를 불러오지 못했습니다.",
	unavailable: "현재 확인할 수 있는 Imgur 정보가 없습니다.",
	unsupported: "이 Imgur URL 형식은 미리보기를 지원하지 않습니다.",
	legacy: "아직 수집된 Imgur 정보가 없습니다.",
};

function getMeaningfulThreadTitle(thread: ThreadItemType) {
	const title = thread.title?.trim();
	if (!title || title === thread.url.trim() || title.toLowerCase() === "untitled") return null;
	return title;
}

function getReadyFallbackTitle(
	mediaKind: ImgurCardModel["mediaKind"],
	mediaCount: number | null,
	externalId: string | null
) {
	const count = mediaCount ?? 0;
	if (mediaKind === "album") return `Imgur 앨범 · ${count}개`;
	if (mediaKind === "gallery") return `Imgur 갤러리 · ${count}개`;
	if (mediaKind === "video") return `Imgur 영상 · ${externalId ?? "미리보기"}`;
	return `Imgur 이미지 · ${externalId ?? "미리보기"}`;
}

function getPreviewUrls(thread: ThreadItemType) {
	const metadata = thread.media_metadata?.provider === "imgur" ? thread.media_metadata : null;
	const candidates = [metadata?.thumbnail_url, ...(metadata?.preview_urls ?? [])];
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const candidate of candidates) {
		const url = getAllowedMediaUrl(candidate, "imgur");
		if (!url || seen.has(url)) continue;
		seen.add(url);
		urls.push(url);
		if (urls.length === 4) break;
	}
	return urls;
}

export function getImgurCardModel(thread: ThreadItemType): ImgurCardModel {
	const metadata = thread.media_metadata?.provider === "imgur" ? thread.media_metadata : null;
	const status: ImgurCardStatus = metadata?.status ?? "legacy";
	const sourceTitle = getMeaningfulThreadTitle(thread);
	const officialTitle = metadata?.title?.trim() || null;
	const previewUrls = getPreviewUrls(thread);
	const mediaCount = metadata?.media_count ?? null;
	const fallbackTitle =
		status === "ready"
			? getReadyFallbackTitle(
					metadata?.media_kind ?? "image",
					mediaCount,
					metadata?.external_id ?? null
				)
			: STATUS_FALLBACK_TITLES[status];

	return {
		status,
		title: officialTitle ?? sourceTitle ?? fallbackTitle,
		sourceContext:
			officialTitle && sourceTitle && officialTitle !== sourceTitle ? sourceTitle : null,
		mediaKind: metadata?.media_kind ?? null,
		mediaCount,
		previewUrls,
	};
}

function ImgurPreviewTile({ url, title, index }: { url: string; title: string; index: number }) {
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const label = `${title} 미리보기 ${index + 1}`;
	if (isVideoMediaUrl(url)) {
		return (
			<div
				role="img"
				aria-label={`${label} · 영상`}
				className="flex aspect-video h-full w-full flex-col items-center justify-center gap-1.5 bg-zinc-950 text-white"
			>
				<Play aria-hidden="true" className="size-8" />
				<span className="text-xs">영상</span>
			</div>
		);
	}
	if (failedSrc === url) {
		return (
			<div
				role="img"
				aria-label={`${label} 없음`}
				className="flex aspect-video h-full w-full flex-col items-center justify-center gap-1.5 bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
			>
				<ImageOff aria-hidden="true" className="size-6" />
				<span className="text-xs">미리보기 없음</span>
			</div>
		);
	}
	return (
		<div className="relative aspect-video h-full w-full">
			<Image
				src={url}
				alt={label}
				fill
				unoptimized={isGifMediaUrl(url)}
				sizes="(min-width: 640px) 11rem, 50vw"
				className="object-cover"
				onError={() => setFailedSrc(url)}
			/>
		</div>
	);
}

function ImgurPreviewGrid({ model }: { model: ImgurCardModel }) {
	if (model.previewUrls.length === 0) {
		return (
			<div
				role="img"
				aria-label={`${model.title} 미리보기 없음`}
				className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-md bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
			>
				<ImageOff aria-hidden="true" className="size-7" />
				<span className="text-xs">미리보기 없음</span>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"grid w-full gap-1 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-900",
				model.previewUrls.length === 1 ? "grid-cols-1" : "grid-cols-2"
			)}
			data-preview-count={model.previewUrls.length}
		>
			{model.previewUrls.map((url, index) => (
				<ImgurPreviewTile key={url} url={url} title={model.title} index={index} />
			))}
		</div>
	);
}

function ImgurKindBadges({ model }: { model: ImgurCardModel }) {
	const count = model.mediaCount ?? model.previewUrls.length;
	const hasGif = model.previewUrls.some(isGifMediaUrl);
	const hasVideo = model.previewUrls.some(isVideoMediaUrl);
	const kindLabel =
		model.mediaKind === "album"
			? `앨범 · ${count}개`
			: model.mediaKind === "gallery"
				? `갤러리 · ${count}개`
				: model.mediaKind === "video"
					? "영상"
					: hasGif
						? "GIF"
						: "이미지";

	return (
		<>
			<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
				{kindLabel}
			</Badge>
			{model.mediaKind !== "video" && hasVideo ? (
				<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
					영상
				</Badge>
			) : null}
			{model.mediaKind !== "image" && hasGif ? (
				<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
					GIF
				</Badge>
			) : null}
		</>
	);
}

export function ImgurPreviewPanel({
	model,
	threadUrl,
	headingId,
}: {
	model: ImgurCardModel;
	threadUrl: string;
	headingId: string;
}) {
	return (
		<div className="mx-auto flex max-h-[80vh] w-full max-w-4xl flex-col gap-4 overflow-y-auto p-4 sm:p-6">
			<div>
				<h2 id={headingId} className="font-semibold text-lg">
					{model.title} 미리보기
				</h2>
				<p className="text-sm text-zinc-500 dark:text-zinc-400">
					저장된 미리보기 {model.previewUrls.length}개
				</p>
			</div>
			<ImgurPreviewGrid model={model} />
			<Button asChild variant="outline">
				<a href={threadUrl} target="_blank" rel="noreferrer">
					<ExternalLink aria-hidden="true" className="mr-1 size-4" />
					Imgur 원본 열기
				</a>
			</Button>
		</div>
	);
}

function ImgurPreviewDrawer({ model, threadUrl }: { model: ImgurCardModel; threadUrl: string }) {
	const headingId = useId();
	return (
		<Drawer setBackgroundColorOnScale={false}>
			<DrawerTrigger asChild>
				<Button variant="secondary" size="sm" type="button">
					<Images aria-hidden="true" className="mr-1 size-3.5" />
					미리보기
				</Button>
			</DrawerTrigger>
			<DrawerContent aria-labelledby={headingId}>
				<ImgurPreviewPanel model={model} threadUrl={threadUrl} headingId={headingId} />
				<div className="mx-auto w-full max-w-4xl px-4 pb-4 sm:px-6 sm:pb-6">
					<DrawerClose asChild>
						<Button variant="outline" className="w-full" type="button">
							<X aria-hidden="true" className="mr-1 size-4" />
							미리보기 닫기
						</Button>
					</DrawerClose>
				</div>
			</DrawerContent>
		</Drawer>
	);
}

function ImgurPendingContent({
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
			aria-label="Imgur 정보를 불러오는 중"
			data-media-status="pending"
			className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(12rem,14rem)_minmax(0,1fr)]"
		>
			<div className="aspect-video w-full animate-pulse rounded-md bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-900" />
			<div className="min-w-0 space-y-3">
				<div className="flex flex-wrap gap-1.5">
					<Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
						Imgur
					</Badge>
					<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
						정보 확인 중
					</Badge>
					{meta}
				</div>
				<div className="h-5 w-5/6 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-900" />
				<div className="h-4 w-2/5 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-900" />
				<Button
					variant="outline"
					size="sm"
					type="button"
					aria-label={`${title} Imgur에서 열기`}
					onClick={onOpen}
				>
					<ExternalLink aria-hidden="true" className="mr-1 size-3.5" />
					Open
				</Button>
			</div>
		</div>
	);
}

export function ImgurThreadContent({
	thread,
	onOpen,
	meta,
}: {
	thread: ThreadItemType;
	onOpen: () => void;
	meta?: React.ReactNode;
}) {
	const model = getImgurCardModel(thread);
	if (model.status === "pending") {
		return <ImgurPendingContent thread={thread} onOpen={onOpen} meta={meta} />;
	}

	const message = STATUS_MESSAGES[model.status];
	return (
		<div
			data-testid="imgur-thread-content"
			data-media-status={model.status}
			className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(12rem,14rem)_minmax(0,1fr)]"
		>
			<ImgurPreviewGrid model={model} />
			<div className="flex min-w-0 flex-col gap-2">
				<div className="flex flex-wrap items-center gap-1.5">
					<Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
						Imgur
					</Badge>
					{thread.host ? (
						<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
							{thread.host}
						</Badge>
					) : null}
					{model.status === "ready" ? <ImgurKindBadges model={model} /> : null}
					{model.status === "failed" ? (
						<Badge variant="destructive" className="px-1.5 py-0 text-[11px]">
							불러오기 실패
						</Badge>
					) : null}
					{model.status === "unavailable" ? (
						<Badge variant="outline" className="px-1.5 py-0 text-[11px]">
							정보 없음
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
					aria-label={`${model.title} Imgur에서 열기`}
					className="-mx-1 rounded-md px-1 py-1 text-left font-semibold text-[15px] leading-6 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 sm:text-base dark:focus-visible:ring-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
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
				{model.sourceContext ? (
					<p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
						수집 문맥: {model.sourceContext}
					</p>
				) : null}
				{message ? (
					<p role="status" className="text-xs text-zinc-600 dark:text-zinc-300">
						{message}
					</p>
				) : null}
				<div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
					<Link2 aria-hidden="true" className="size-3 shrink-0" />
					<span className="truncate">{thread.url}</span>
				</div>
				<div className="mt-auto flex flex-wrap items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						type="button"
						aria-label={`${model.title} Imgur에서 열기`}
						onClick={onOpen}
					>
						<ExternalLink aria-hidden="true" className="mr-1 size-3.5" />
						Open
					</Button>
					{model.status === "ready" && model.previewUrls.length > 0 ? (
						<ImgurPreviewDrawer model={model} threadUrl={thread.url} />
					) : null}
				</div>
			</div>
		</div>
	);
}

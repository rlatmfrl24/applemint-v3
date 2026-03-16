"use client";

import { ExternalLink, Link2 } from "lucide-react";
import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ThreadItemType } from "@/lib/typeDefs";

export function ThreadCard({
	thread,
	actions,
	meta,
}: {
	thread: ThreadItemType;
	actions?: React.ReactNode;
	meta?: React.ReactNode;
}) {
	const handleOpen = useCallback(() => {
		window.open(thread.url, "_blank", "noopener,noreferrer");
	}, [thread.url]);

	return (
		<Card className="w-full border-zinc-200/80 shadow-none transition-colors duration-150 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700">
			<CardContent className="flex flex-col gap-3 p-3">
				<div className="flex items-start gap-3">
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
						<button
							type="button"
							className="-mx-1 w-full rounded-md px-1 py-1 text-left font-semibold text-[15px] leading-6 transition-colors hover:bg-zinc-100 hover:text-zinc-600 sm:text-base dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
							onClick={handleOpen}
							style={{
								display: "-webkit-box",
								WebkitBoxOrient: "vertical",
								WebkitLineClamp: 2,
								overflow: "hidden",
							}}
						>
							{thread.title || "Untitled"}
						</button>
						<div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
							<Link2 className="size-3 shrink-0" />
							<span className="truncate">{thread.url}</span>
						</div>
						{thread.description ? (
							<p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
								{thread.description}
							</p>
						) : null}
					</div>
					<Button
						variant="outline"
						size="sm"
						className="shrink-0"
						type="button"
						onClick={handleOpen}
					>
						<ExternalLink className="mr-1 size-3.5" />
						Open
					</Button>
				</div>
				{actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
			</CardContent>
		</Card>
	);
}

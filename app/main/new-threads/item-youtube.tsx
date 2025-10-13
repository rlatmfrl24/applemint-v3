import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { ThreadItemType } from "@/lib/typeDefs";
import { QuickSaveButton } from "../quick-save-button";
import { useMoveThreadToTrash } from "./use-move-to-trash";

function getYoutubeId(url: string) {
	// get youtube video id from short url
	const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
	const match = url.match(regExp);
	return match && match[2].length === 11 ? match[2] : null;
}
export const YoutubeItem = ({ thread }: { thread: ThreadItemType }) => {
	const moveThreadToTrash = useMoveThreadToTrash(thread);

	const handleDelete = useCallback(
		(id: string | number) => {
			moveThreadToTrash.mutate(String(id));
		},
		[moveThreadToTrash]
	);

	const thumbnailId = getYoutubeId(thread.url);
	const title =
		thread.title.length === 0 || thread.title === thread.url ? "Untitled" : thread.title;

	return (
		<Card
			key={thread.id}
			className="w-full cursor-pointer transition-colors duration-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
			onClick={() => window.open(thread.url, "_blank")}
		>
			<CardHeader>
				<CardTitle className="overflow-hidden text-ellipsis whitespace-nowrap">
					<div className="mb-2">{title}</div>
					{thumbnailId ? (
						<Image
							src={`https://img.youtube.com/vi/${thumbnailId}/0.jpg`}
							alt={title}
							className="h-56 w-full object-cover"
							width={0}
							height={0}
							sizes="100vw"
						/>
					) : (
						<div className="h-56 w-full">Empty</div>
					)}
				</CardTitle>
				<CardDescription className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
					{thread.url}
				</CardDescription>
			</CardHeader>
			<CardFooter className="flex items-center justify-between">
				<Button
					size="sm"
					onClick={(e) => {
						e.stopPropagation();
						handleDelete(thread.id);
					}}
				>
					{moveThreadToTrash.isPending ? <Loader2 className="animate-spin" /> : "Delete"}
				</Button>
				<QuickSaveButton thread={thread} />
			</CardFooter>
		</Card>
	);
};

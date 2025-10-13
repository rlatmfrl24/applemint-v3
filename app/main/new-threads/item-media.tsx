import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { MediaItemType, ThreadItemType } from "@/lib/typeDefs";
import { QuickSaveButton } from "../quick-save-button";
import { useMoveThreadToTrash } from "./use-move-to-trash";

export const MediaItem = ({
	thread,
	onClick,
}: {
	thread: MediaItemType;
	onClick: (url: ThreadItemType) => void;
}) => {
	const moveThreadToTrash = useMoveThreadToTrash(thread);

	const handleDelete = useCallback(
		(id: string | number) => {
			moveThreadToTrash.mutate(String(id));
		},
		[moveThreadToTrash]
	);

	return (
		<motion.div exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}>
			<Card
				key={thread.id}
				className="flex h-full w-full max-w-full cursor-pointer flex-col transition-colors duration-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
				onClick={() => onClick(thread)}
			>
				<CardHeader className="h-full">
					<CardTitle className="h-full w-full max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
						<div className="mb-2">{thread.title || "Untitled"}</div>
						<Thumbnail
							url={thread.sub_url && thread.sub_url?.length > 0 ? thread.sub_url[0] : ""}
						/>
					</CardTitle>
					<CardDescription className="w-full max-w-full overflow-hidden text-ellipsis">
						{thread.url}
					</CardDescription>
				</CardHeader>
				<CardFooter className="flex items-center justify-between">
					<Button
						size={"sm"}
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
		</motion.div>
	);
};

const Thumbnail = ({ url }: { url: string }) => {
	if (!url)
		return (
			<div className="flex h-56 w-full items-center justify-center rounded bg-gray-500">Empty</div>
		);
	if (url.includes("mp4")) {
		return (
			<video src={url} controls className="h-56 w-full object-cover">
				<track kind="captions" />
			</video>
		);
	}

	return (
		<div className="h-full min-h-56 rounded">
			<Image
				src={url}
				alt="thumbnail"
				width={0}
				height={0}
				sizes="100vw"
				className="h-56 w-full object-cover"
			/>
		</div>
	);
};

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { MediaItemType, ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { QuickSaveButton } from "../quick-save-button";

export const MediaItem = ({
	thread,
	onClick,
}: {
	thread: MediaItemType;
	onClick: (url: ThreadItemType) => void;
}) => {
	const queryClient = useQueryClient();
	const supabase = createClient();
	const [isPending, setIsPending] = useState(false);

	const invalidateQueries = useCallback(async () => {
		await queryClient.invalidateQueries({
			queryKey: ["new-threads"],
			predicate: ({ queryKey }) => queryKey.includes("new-threads"),
		});
	}, [queryClient]);

	const handleDelete = useCallback(
		async (id: string) => {
			try {
				setIsPending(true);
				const { error: deleteError } = await supabase
					.from("new-threads")
					.delete()
					.eq("id", Number.parseInt(id, 10));
				if (deleteError) {
					throw deleteError;
				}

				const { error: trashError } = await supabase.from("trash").insert([
					{
						type: thread.type,
						url: thread.url,
						title: thread.title,
						description: thread.description,
						host: thread.host,
					},
				]);

				if (trashError) {
					throw trashError;
				}

				toast.success("스레드를 휴지통으로 이동했습니다.");
				await invalidateQueries();
			} catch (error) {
				console.error("🚀 ~ handleDelete ~ error", error);
				toast.error("스레드 이동 중 오류가 발생했습니다.");
			} finally {
				setIsPending(false);
			}
		},
		[
			invalidateQueries,
			supabase,
			thread.description,
			thread.host,
			thread.title,
			thread.type,
			thread.url,
		]
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
						onClick={async (e) => {
							e.stopPropagation();
							await handleDelete(thread.id);
						}}
					>
						{isPending ? <Loader2 className="animate-spin" /> : "Delete"}
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

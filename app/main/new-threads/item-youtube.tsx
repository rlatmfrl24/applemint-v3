import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { QuickSaveButton } from "../quick-save-button";

function getYoutubeId(url: string) {
	// get youtube video id from short url
	const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
	const match = url.match(regExp);
	return match && match[2].length === 11 ? match[2] : null;
}
export const YoutubeItem = ({ thread }: { thread: ThreadItemType }) => {
	const supabase = createClient();
	const queryClient = useQueryClient();
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
				console.error("Failed to move thread to trash:", error);
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
						void handleDelete(thread.id);
					}}
				>
					{isPending ? <Loader2 className="animate-spin" /> : "Delete"}
				</Button>
				<QuickSaveButton thread={thread} />
			</CardFooter>
		</Card>
	);
};

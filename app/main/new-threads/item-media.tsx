import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import Image from "next/image";
import type { MediaItemType, ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
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

	const mediaThreadMutation = useMutation({
		mutationFn: async (id: string) => {
			const { error: DeleteError } = await supabase
				.from("new-threads")
				.delete()
				.eq("id", Number.parseInt(id));
			if (DeleteError) {
				console.error("🚀 ~ removeThread ~ error", DeleteError);
				return;
			}

			const { error: TrashInsertError } = await supabase.from("trash").insert([
				{
					type: thread.type,
					url: thread.url,
					title: thread.title,
					description: thread.description,
					host: thread.host,
				},
			]);

			if (TrashInsertError) {
				console.error("🚀 ~ removeThread ~ error", TrashInsertError);
				return;
			}
		},
		onSettled: async () => {
			return await queryClient.invalidateQueries({
				queryKey: ["new-threads"],
			});
		},
		onError: (error) => {
			console.error("🚀 ~ mediaThreadMutation ~ error", error);
		},
	});

	return (
		<motion.div exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}>
			<Card
				key={thread.id}
				className="cursor-pointer max-w-full w-full flex flex-col dark:hover:bg-zinc-800 hover:bg-zinc-100 transition-colors duration-200"
				onClick={() => onClick(thread)}
			>
				<CardHeader>
					<CardTitle className="max-w-full w-full text-ellipsis overflow-hidden whitespace-nowrap">
						<div className="mb-2">{thread.title || "Untitled"}</div>
						{thread.sub_url && thread.sub_url?.length > 0 && (
							<Image
								src={thread.sub_url[0]}
								alt="thumbnail"
								width={0}
								height={0}
								sizes="100vw"
								className="w-full h-56 object-cover"
							/>
						)}
					</CardTitle>
					<CardDescription className="max-w-full w-full text-ellipsis overflow-hidden">
						{thread.url}
					</CardDescription>
				</CardHeader>
				<CardFooter className="flex items-center justify-between">
					<Button
						size={"sm"}
						onClick={async (e) => {
							e.stopPropagation();
							mediaThreadMutation.mutate(thread.id);
						}}
					>
						{mediaThreadMutation.isPending ? (
							<Loader2 className="animate-spin" />
						) : (
							"Delete"
						)}
					</Button>
					<QuickSaveButton thread={thread} />
				</CardFooter>
			</Card>
		</motion.div>
	);
};

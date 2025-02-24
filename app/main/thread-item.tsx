import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const DefaultThreadItem = ({
	thread,
	threadName,
	extraButtons,
	disablePrimaryAction,
}: {
	thread: ThreadItemType;
	threadName: string;
	extraButtons?: React.ReactNode;
	disablePrimaryAction?: boolean;
}) => {
	const queryClient = useQueryClient();

	const removeThread = useMutation({
		mutationFn: async (id: string) => {
			const supabase = createClient();
			const { error: DeleteError } = await supabase
				.from(threadName)
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
				queryKey: [threadName],
			});
		},
	});

	return (
		<motion.div
			key={thread.id}
			exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
		>
			<Card
				className="cursor-pointer max-w-full w-full hover:bg-zinc-200 dark:hover:bg-zinc-900 transition-colors duration-200"
				onClick={() => {
					window.open(thread.url, "_blank");
				}}
			>
				<CardHeader className="max-w-full">
					<CardTitle className="max-w-full w-full text-ellipsis overflow-hidden">
						{thread.title || "Untitled"}
					</CardTitle>
					<CardDescription className="max-w-full w-full text-ellipsis overflow-hidden">
						{thread.url}
					</CardDescription>
				</CardHeader>
				<CardFooter className="flex gap-2 items-center justify-between">
					{disablePrimaryAction ? null : (
						<Button
							size={"sm"}
							disabled={removeThread.isPending}
							onClick={async (e) => {
								e.stopPropagation();
								removeThread.mutate(thread.id);
							}}
						>
							{!removeThread.isPending ? (
								"Delete"
							) : (
								<Loader2 className="animate-spin" />
							)}
						</Button>
					)}
					<div
						className="flex gap-2"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						{extraButtons}
					</div>
				</CardFooter>
			</Card>
		</motion.div>
	);
};

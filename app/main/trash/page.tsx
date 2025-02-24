"use client";

import { Button } from "@/components/ui/button";
import type { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import {
	QueryClient,
	QueryClientProvider,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export default function TrashPage() {
	const queryClient = new QueryClient();

	return (
		<QueryClientProvider client={queryClient}>
			<TrashThread />
		</QueryClientProvider>
	);
}

function TrashThread() {
	const supabase = createClient();

	const { data, isLoading, error } = useQuery({
		queryKey: ["trash"],
		queryFn: async () => {
			const { data, error } = await supabase
				.from("trash")
				.select()
				.order("created_at", { ascending: false })
				.order("id", { ascending: false });

			if (error) {
				throw new Error(error.message);
			}

			return data;
		},
	});

	const RestoreButton = ({ thread }: { thread: ThreadItemType }) => {
		const queryClient = useQueryClient();
		const restoreMutation = useMutation({
			mutationFn: async () => {
				const { error: DeleteError } = await supabase
					.from("trash")
					.delete()
					.eq("id", thread.id);
				if (DeleteError) {
					console.error("🚀 ~ removeThread ~ error", DeleteError);
					return;
				}
				const { data, error } = await supabase.from("new-threads").insert([
					{
						type: thread.type,
						url: thread.url,
						title: thread.title,
						description: thread.description,
						host: thread.host,
					},
				]);

				if (error) {
					console.error("🚀 ~ quickSaveMutation ~ error", error);
					return;
				}
			},
			onSettled: async () => {
				return await queryClient.invalidateQueries({
					queryKey: ["trash"],
				});
			},
		});

		return (
			<Button
				size={"sm"}
				disabled={restoreMutation.isPending}
				onClick={async (e) => {
					e.stopPropagation();
					restoreMutation.mutate();
				}}
			>
				{restoreMutation.isPending ? "Restoring..." : "Restore"}
			</Button>
		);
	};

	return (
		<div className="flex flex-col gap-2 w-full">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Title</TableHead>
						<TableHead>URL</TableHead>
						<TableHead>Type</TableHead>
						<TableHead>Host</TableHead>
						<TableHead>Created At</TableHead>
						<TableHead>Action</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{isLoading &&
						Array.from({ length: 5 }).map((_, index) => (
							<TableRow
								key={`table-skeleton-${index}-${Math.random()
									.toString(36)
									.substring(7)}`}
							>
								<TableCell>
									<Skeleton className="h-5 rounded-xl" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-5 rounded-xl" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-5 rounded-xl" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-5 rounded-xl" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-5 rounded-xl" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-5 rounded-xl" />
								</TableCell>
							</TableRow>
						))}
					{data?.map((thread) => (
						<TableRow key={thread.id}>
							<TableCell className="max-w-96 overflow-ellipsis overflow-hidden text-nowrap">
								{thread.url}
							</TableCell>
							<TableCell>{thread.title || "Undefined"}</TableCell>
							<TableCell>{thread.type}</TableCell>
							<TableCell>{thread.host}</TableCell>
							<TableCell className="text-nowrap">
								{format(new Date(thread.created_at), "yyyy-MM-dd HH:mm:ss")}
							</TableCell>
							<TableCell>
								<RestoreButton thread={thread} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			{/* <AnimatePresence>
				{data?.map((thread) => (
					<DefaultThreadItem
						key={thread.id}
						thread={thread}
						threadName="trash"
						disablePrimaryAction
						extraButtons={<RestoreButton thread={thread} />}
					/>
				))}
			</AnimatePresence> */}
		</div>
	);
}

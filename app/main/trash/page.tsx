"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ThreadCard } from "@/app/main/thread-card";
import { Button } from "@/components/ui/button";
import {
	applyMoveThreadOptimisticUpdates,
	getThreadInsertPayload,
	invalidateThreadQueries,
	type QuerySnapshot,
	rollbackSnapshots,
} from "@/lib/thread-query-cache";
import type { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { ThreadLoading } from "../new-threads/thread-loading";
import NoDataBox from "../no-data";

export default function TrashPage() {
	return <TrashThread />;
}

function RestoreButton({ thread }: { thread: ThreadItemType }) {
	const supabase = createClient();
	const queryClient = useQueryClient();

	const restoreMutation = useMutation<void, unknown, void, QuerySnapshot[]>({
		mutationFn: async () => {
			const { error: deleteError } = await supabase.from("trash").delete().eq("id", thread.id);

			if (deleteError) {
				throw deleteError;
			}

			const { error: insertError } = await supabase
				.from("new-threads")
				.insert([getThreadInsertPayload(thread)]);

			if (insertError) {
				throw insertError;
			}
		},
		onMutate: async () => {
			await queryClient.cancelQueries({
				predicate: (query) =>
					Array.isArray(query.queryKey) &&
					(query.queryKey[0] === "trash" || query.queryKey[0] === "new-threads"),
			});

			return applyMoveThreadOptimisticUpdates(queryClient, {
				sourceTable: "trash",
				destinationTable: "new-threads",
				thread,
			});
		},
		onSuccess: () => {
			toast.success("스레드를 복구했습니다.");
		},
		onError: (error, _variables, snapshots) => {
			rollbackSnapshots(queryClient, snapshots ?? []);
			console.error("휴지통 복구 실패", error);
			toast.error("복구 중 오류가 발생했습니다.");
		},
		onSettled: async () => {
			await invalidateThreadQueries(queryClient, ["trash", "new-threads"]);
		},
	});

	return (
		<Button
			size="sm"
			type="button"
			disabled={restoreMutation.isPending}
			onClick={() => {
				restoreMutation.mutate();
			}}
		>
			{restoreMutation.isPending ? (
				<Loader2 className="size-3.5 animate-spin" />
			) : (
				<RotateCcw className="size-3.5" />
			)}
			<span className="ml-1">{restoreMutation.isPending ? "Restoring" : "Restore"}</span>
		</Button>
	);
}

function TrashThread() {
	const supabase = createClient();

	const { data, isLoading } = useQuery({
		queryKey: ["trash"],
		queryFn: async () => {
			const { data, error } = await supabase
				.from("trash")
				.select()
				.order("created_at", { ascending: false })
				.order("id", { ascending: false })
				.limit(50);

			if (error) {
				throw new Error(error.message);
			}

			return data as ThreadItemType[];
		},
	});

	return (
		<div className="flex w-full flex-col gap-2">
			{isLoading ? <ThreadLoading count={5} /> : null}
			{data && data.length === 0 ? <NoDataBox /> : null}
			{data?.map((thread) => (
				<ThreadCard
					key={thread.id}
					thread={thread}
					meta={
						thread.created_at ? (
							<span className="text-[11px] text-zinc-500 dark:text-zinc-400">
								{format(new Date(thread.created_at), "MM-dd HH:mm")}
							</span>
						) : null
					}
					actions={
						<>
							<RestoreButton thread={thread} />
							<Button
								variant="outline"
								size="sm"
								type="button"
								onClick={() => {
									navigator.clipboard.writeText(thread.url);
									toast.success("링크를 복사했습니다.");
								}}
							>
								<Copy className="mr-1 size-3.5" />
								Copy
							</Button>
						</>
					}
				/>
			))}
		</div>
	);
}

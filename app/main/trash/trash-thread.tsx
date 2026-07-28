"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ThreadCard } from "@/app/main/thread-card";
import { Button } from "@/components/ui/button";
import {
	applyMoveThreadOptimisticUpdates,
	invalidateThreadQueries,
	isThreadQueryKeyForStates,
	type QuerySnapshot,
	replaceThreadInCaches,
	rollbackSnapshots,
} from "@/lib/thread-query-cache";
import { type TransitionThreadInput, transitionThreadOptions } from "@/lib/thread-query-options";
import type { ThreadItemType } from "@/lib/type-defs";
import { useTRPCClient } from "@/trpc/client";
import { ThreadInfiniteList } from "../thread-infinite-list";

function RestoreButton({ thread }: { thread: ThreadItemType }) {
	const trpc = useTRPCClient();
	const queryClient = useQueryClient();

	const restoreMutation = useMutation<
		ThreadItemType,
		Error,
		TransitionThreadInput,
		QuerySnapshot[]
	>({
		...transitionThreadOptions(trpc),
		onMutate: async () => {
			await queryClient.cancelQueries({
				predicate: (query) => isThreadQueryKeyForStates(query.queryKey, ["trash", "inbox"]),
			});

			return applyMoveThreadOptimisticUpdates(queryClient, {
				sourceState: "trash",
				destinationState: "inbox",
				thread,
			});
		},
		onSuccess: (item) => {
			replaceThreadInCaches(queryClient, item);
			toast.success("스레드를 복구했습니다.");
		},
		onError: (error, _variables, snapshots) => {
			rollbackSnapshots(queryClient, snapshots ?? []);
			console.error("휴지통 복구 실패", error);
			toast.error("복구 중 오류가 발생했습니다.");
		},
		onSettled: async () => {
			await invalidateThreadQueries(queryClient, ["trash", "inbox"]);
		},
	});

	return (
		<Button
			size="sm"
			type="button"
			disabled={restoreMutation.isPending}
			onClick={() => {
				restoreMutation.mutate({
					id: thread.id,
					expectedState: "trash",
					destinationState: "inbox",
				});
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

export function TrashThread() {
	return (
		<ThreadInfiniteList
			state="trash"
			loadingCount={5}
			renderItem={(thread) => (
				<ThreadCard
					thread={thread}
					meta={
						thread.state_changed_at ? (
							<span className="text-[11px] text-zinc-500 dark:text-zinc-400">
								{format(new Date(thread.state_changed_at), "MM-dd HH:mm")}
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
			)}
		/>
	);
}

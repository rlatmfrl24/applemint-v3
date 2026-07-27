import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { ThreadCard } from "@/app/main/thread-card";
import { Button } from "@/components/ui/button";
import {
	applyMoveThreadOptimisticUpdates,
	invalidateThreadQueries,
	isThreadQueryKeyForStates,
	normalizeThreadId,
	type QuerySnapshot,
	replaceThreadInCaches,
	rollbackSnapshots,
} from "@/lib/thread-query-cache";
import { type TransitionThreadInput, transitionThreadOptions } from "@/lib/thread-query-options";
import type { ThreadItemType, ThreadState } from "@/lib/type-defs";
import { useTRPCClient } from "@/trpc/client";

export const DefaultThreadItem = ({
	thread,
	threadState,
	extraButtons,
	disablePrimaryAction,
}: {
	thread: ThreadItemType;
	threadState: Exclude<ThreadState, "trash">;
	extraButtons?: React.ReactNode;
	disablePrimaryAction?: boolean;
}) => {
	const trpc = useTRPCClient();
	const queryClient = useQueryClient();

	const removeThread = useMutation<ThreadItemType, Error, TransitionThreadInput, QuerySnapshot[]>({
		...transitionThreadOptions(trpc),
		onMutate: async () => {
			await queryClient.cancelQueries({
				predicate: (query) => isThreadQueryKeyForStates(query.queryKey, [threadState, "trash"]),
			});

			return applyMoveThreadOptimisticUpdates(queryClient, {
				sourceState: threadState,
				destinationState: "trash",
				thread,
			});
		},
		onSuccess: (item) => {
			replaceThreadInCaches(queryClient, item);
			toast.success("휴지통으로 이동했습니다.");
		},
		onError: (error, _id, snapshots) => {
			rollbackSnapshots(queryClient, snapshots ?? []);
			console.error("스레드 휴지통 이동 실패", error);
			toast.error("스레드 이동 중 오류가 발생했습니다.");
		},
		onSettled: async () => {
			await invalidateThreadQueries(queryClient, [threadState, "trash"]);
		},
	});

	const isDeleting = removeThread.isPending;

	const handleDelete = useCallback(() => {
		const idAsString = normalizeThreadId(thread.id);

		removeThread.mutate({
			id: idAsString,
			expectedState: threadState,
			destinationState: "trash",
		});
	}, [removeThread, thread.id, threadState]);

	return (
		<ThreadCard
			thread={thread}
			actions={
				<>
					{disablePrimaryAction ? null : (
						<Button
							variant="destructive"
							size="sm"
							disabled={isDeleting}
							type="button"
							onClick={handleDelete}
						>
							{isDeleting ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Trash2 className="size-3.5" />
							)}
							<span className="ml-1">{isDeleting ? "Moving" : "Trash"}</span>
						</Button>
					)}
					{extraButtons}
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
	);
};

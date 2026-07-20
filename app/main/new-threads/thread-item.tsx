import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { ThreadCard } from "@/app/main/thread-card";
import { Button } from "@/components/ui/button";
import { moveThread } from "@/lib/thread-mutations";
import {
	applyMoveThreadOptimisticUpdates,
	invalidateThreadQueries,
	isThreadQueryKeyForTables,
	normalizeThreadId,
	type QuerySnapshot,
	rollbackSnapshots,
	type ThreadTableName,
} from "@/lib/thread-query-cache";
import type { ThreadItemType } from "@/lib/type-defs";
import { createClient } from "@/utils/supabase/client";
import { useMoveThreadToTrash } from "./use-move-to-trash";

export const DefaultThreadItem = ({
	thread,
	threadName,
	extraButtons,
	disablePrimaryAction,
}: {
	thread: ThreadItemType;
	threadName: Exclude<ThreadTableName, "trash">;
	extraButtons?: React.ReactNode;
	disablePrimaryAction?: boolean;
}) => {
	const queryClient = useQueryClient();
	const supabase = createClient();

	const removeThread = useMutation<void, unknown, string, QuerySnapshot[]>({
		mutationFn: async (id) => {
			await moveThread(supabase, id, threadName, "trash");
		},
		onMutate: async () => {
			await queryClient.cancelQueries({
				predicate: (query) => isThreadQueryKeyForTables(query.queryKey, [threadName, "trash"]),
			});

			return applyMoveThreadOptimisticUpdates(queryClient, {
				sourceTable: threadName,
				destinationTable: "trash",
				thread,
			});
		},
		onSuccess: () => {
			toast.success("휴지통으로 이동했습니다.");
		},
		onError: (error, _id, snapshots) => {
			rollbackSnapshots(queryClient, snapshots ?? []);
			console.error("스레드 휴지통 이동 실패", error);
			toast.error("스레드 이동 중 오류가 발생했습니다.");
		},
		onSettled: async () => {
			await invalidateThreadQueries(queryClient, [threadName, "trash"]);
		},
	});

	const moveNewThreadToTrash = useMoveThreadToTrash(thread);
	const isNewThreadsScope = threadName === "new-threads";

	const isDeleting = isNewThreadsScope ? moveNewThreadToTrash.isPending : removeThread.isPending;

	const handleDelete = useCallback(() => {
		const idAsString = normalizeThreadId(thread.id);

		if (isNewThreadsScope) {
			moveNewThreadToTrash.mutate(idAsString);
			return;
		}

		removeThread.mutate(idAsString);
	}, [isNewThreadsScope, moveNewThreadToTrash, removeThread, thread.id]);

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

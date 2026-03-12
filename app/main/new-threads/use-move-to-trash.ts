import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	applyMoveThreadOptimisticUpdates,
	getThreadInsertPayload,
	invalidateThreadQueries,
	normalizeThreadId,
	type QuerySnapshot,
	rollbackSnapshots,
} from "@/lib/thread-query-cache";
import type { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";

export const useMoveThreadToTrash = (thread: ThreadItemType) => {
	const supabase = createClient();
	const queryClient = useQueryClient();

	return useMutation<string, unknown, string, QuerySnapshot[]>({
		mutationFn: async (threadId) => {
			const normalizedId = normalizeThreadId(threadId);
			const parsedId = Number.parseInt(normalizedId, 10);
			const deleteIdentifier = Number.isNaN(parsedId) ? normalizedId : parsedId;

			const { error: deleteError } = await supabase
				.from("new-threads")
				.delete()
				.eq("id", deleteIdentifier);

			if (deleteError) {
				throw deleteError;
			}

			const { error: trashError } = await supabase
				.from("trash")
				.insert([getThreadInsertPayload(thread)]);

			if (trashError) {
				throw trashError;
			}

			return threadId;
		},
		onMutate: async (threadId) => {
			await queryClient.cancelQueries({
				predicate: (query) =>
					Array.isArray(query.queryKey) &&
					(query.queryKey[0] === "new-threads" || query.queryKey[0] === "trash"),
			});

			return applyMoveThreadOptimisticUpdates(queryClient, {
				sourceTable: "new-threads",
				destinationTable: "trash",
				thread: {
					...thread,
					id: normalizeThreadId(threadId),
				},
			});
		},
		onSuccess: () => {
			toast.success("스레드를 휴지통으로 이동했습니다.");
		},
		onError: (error, _threadId, snapshots) => {
			rollbackSnapshots(queryClient, snapshots ?? []);
			console.error("신규 스레드 휴지통 이동 실패", error);
			toast.error("스레드 이동 중 오류가 발생했습니다.");
		},
		onSettled: async () => {
			await invalidateThreadQueries(queryClient, ["new-threads", "trash"]);
		},
	});
};

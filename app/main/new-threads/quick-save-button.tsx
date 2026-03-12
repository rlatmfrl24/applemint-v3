import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

export const QuickSaveButton = ({ thread }: { thread: ThreadItemType }) => {
	const supabase = createClient();
	const queryClient = useQueryClient();

	const quickSaveMutation = useMutation<void, unknown, void, QuerySnapshot[]>({
		mutationFn: async () => {
			const normalizedId = normalizeThreadId(thread.id);
			const numericId = /^\d+$/.test(normalizedId) ? Number(normalizedId) : null;
			const deleteIdentifier = numericId ?? normalizedId;

			const { error: deleteError } = await supabase
				.from("new-threads")
				.delete()
				.eq("id", deleteIdentifier);
			if (deleteError) {
				throw deleteError;
			}

			const { error: insertError } = await supabase
				.from("quick-save")
				.insert([getThreadInsertPayload(thread)]);

			if (insertError) {
				throw insertError;
			}
		},
		onMutate: async () => {
			await queryClient.cancelQueries({
				predicate: (query) =>
					Array.isArray(query.queryKey) &&
					(query.queryKey[0] === "new-threads" || query.queryKey[0] === "quick-save"),
			});

			return applyMoveThreadOptimisticUpdates(queryClient, {
				sourceTable: "new-threads",
				destinationTable: "quick-save",
				thread,
			});
		},
		onSuccess: () => {
			toast.success("퀵 세이브로 이동했습니다.");
		},
		onError: (error, _variables, snapshots) => {
			rollbackSnapshots(queryClient, snapshots ?? []);
			console.error("퀵 세이브 이동 실패", error);
			toast.error("퀵 세이브 처리 중 오류가 발생했습니다.");
		},
		onSettled: async () => {
			await invalidateThreadQueries(queryClient, ["new-threads", "quick-save"]);
		},
	});

	return (
		<Button
			variant="secondary"
			size="sm"
			disabled={quickSaveMutation.isPending}
			type="button"
			onClick={() => {
				quickSaveMutation.mutate();
			}}
		>
			{quickSaveMutation.isPending ? (
				<Loader2 className="size-3.5 animate-spin" />
			) : (
				<BookmarkPlus className="size-3.5" />
			)}
			<span className="ml-1">{quickSaveMutation.isPending ? "Saving" : "Quick Save"}</span>
		</Button>
	);
};

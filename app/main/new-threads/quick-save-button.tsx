import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { moveThread } from "@/lib/thread-mutations";
import {
	applyMoveThreadOptimisticUpdates,
	invalidateThreadQueries,
	type QuerySnapshot,
	rollbackSnapshots,
} from "@/lib/thread-query-cache";
import type { ThreadItemType } from "@/lib/type-defs";
import { createClient } from "@/utils/supabase/client";

export const QuickSaveButton = ({ thread }: { thread: ThreadItemType }) => {
	const supabase = createClient();
	const queryClient = useQueryClient();

	const quickSaveMutation = useMutation<void, unknown, void, QuerySnapshot[]>({
		mutationFn: async () => {
			await moveThread(supabase, thread.id, "new-threads", "quick-save");
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

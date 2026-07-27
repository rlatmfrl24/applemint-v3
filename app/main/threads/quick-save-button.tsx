import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
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

export const QuickSaveButton = ({ thread }: { thread: ThreadItemType }) => {
	const trpc = useTRPCClient();
	const queryClient = useQueryClient();

	const quickSaveMutation = useMutation<
		ThreadItemType,
		Error,
		TransitionThreadInput,
		QuerySnapshot[]
	>({
		...transitionThreadOptions(trpc),
		onMutate: async () => {
			await queryClient.cancelQueries({
				predicate: (query) => isThreadQueryKeyForStates(query.queryKey, ["inbox", "saved"]),
			});

			return applyMoveThreadOptimisticUpdates(queryClient, {
				sourceState: "inbox",
				destinationState: "saved",
				thread,
			});
		},
		onSuccess: (item) => {
			replaceThreadInCaches(queryClient, item);
			toast.success("퀵 세이브로 이동했습니다.");
		},
		onError: (error, _variables, snapshots) => {
			rollbackSnapshots(queryClient, snapshots ?? []);
			console.error("퀵 세이브 이동 실패", error);
			toast.error("퀵 세이브 처리 중 오류가 발생했습니다.");
		},
		onSettled: async () => {
			await invalidateThreadQueries(queryClient, ["inbox", "saved"]);
		},
	});

	return (
		<Button
			variant="secondary"
			size="sm"
			disabled={quickSaveMutation.isPending}
			type="button"
			onClick={() => {
				quickSaveMutation.mutate({
					id: thread.id,
					expectedState: "inbox",
					destinationState: "saved",
				});
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

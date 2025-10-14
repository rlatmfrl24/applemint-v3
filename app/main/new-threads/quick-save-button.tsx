import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";

export const QuickSaveButton = ({ thread }: { thread: ThreadItemType }) => {
	const supabase = createClient();
	const queryClient = useQueryClient();

	const quickSaveMutation = useMutation({
		mutationFn: async () => {
			const numericId =
				typeof thread.id === "number"
					? thread.id
					: typeof thread.id === "string" && /^\d+$/.test(thread.id)
						? Number(thread.id)
						: null;

			const deleteIdentifier = numericId ?? thread.id;

			const { error: deleteError } = await supabase
				.from("new-threads")
				.delete()
				.eq("id", deleteIdentifier);
			if (deleteError) {
				throw deleteError;
			}

			const { error: insertError } = await supabase.from("quick-save").insert([
				{
					type: thread.type,
					url: thread.url,
					title: thread.title,
					description: thread.description,
					host: thread.host,
				},
			]);

			if (insertError) {
				throw insertError;
			}
		},
		onSuccess: async () => {
			toast.success("퀵 세이브로 이동했습니다.");
			await queryClient.invalidateQueries({
				predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "new-threads",
			});
		},
		onError: (error) => {
			console.error("🚀 ~ quickSaveMutation ~ error", error);
			toast.error("퀵 세이브 처리 중 오류가 발생했습니다.");
		},
	});

	return (
		<Button
			variant={"secondary"}
			className="w-full sm:w-auto"
			disabled={quickSaveMutation.isPending}
			onClick={async (e) => {
				e.stopPropagation();
				quickSaveMutation.mutate();
			}}
		>
			{quickSaveMutation.isPending ? "Saving..." : "Quick Save"}
		</Button>
	);
};

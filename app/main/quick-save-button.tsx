import { Button } from "@/components/ui/button";
import type { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { useQueryClient, useMutation } from "@tanstack/react-query";

export const QuickSaveButton = ({ thread }: { thread: ThreadItemType }) => {
	const supabase = createClient();
	const queryClient = useQueryClient();
	const quickSaveMutation = useMutation({
		mutationFn: async () => {
			const { error: DeleteError } = await supabase
				.from("new-threads")
				.delete()
				.eq("id", thread.id);
			if (DeleteError) {
				console.error("🚀 ~ removeThread ~ error", DeleteError);
				return;
			}
			const { data, error } = await supabase.from("quick-save").insert([
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

			return data;
		},
		onSettled: async () => {
			return await queryClient.invalidateQueries({
				queryKey: ["new-threads"],
			});
		},
	});

	return (
		<Button
			size={"sm"}
			variant={"ghost"}
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

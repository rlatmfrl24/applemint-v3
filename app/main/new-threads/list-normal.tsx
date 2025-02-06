import { ThreadItemType } from "@/lib/typeDefs";
import { AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";

export const NormalThreads = () => {
  const supabase = createClient();

  const {
    data: normalThreads,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["new-threads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("new-threads")
        .select()
        .or("type.eq.normal,type.eq.fmkorea,type.eq.battlepage")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (error) {
        console.error(error);
      }

      return data as ThreadItemType[];
    },
  });

  const QuickSaveButton = ({ thread }: { thread: ThreadItemType }) => {
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
        size={`sm`}
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

  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence>
        {isLoading && <ThreadLoading />}
        {normalThreads?.map((thread) => (
          <DefaultThreadItem
            key={thread.id}
            thread={thread}
            threadName="new-threads"
            extraButtons={<QuickSaveButton thread={thread} />}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

"use client";

import { Button } from "@/components/ui/button";
import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";

export default function TrashPage() {
  const queryClient = new QueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <TrashThread />
    </QueryClientProvider>
  );
}

function TrashThread() {
  const supabase = createClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["trash"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trash")
        .select()
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      return data;
    },
  });

  const RestoreButton = ({ thread }: { thread: ThreadItemType }) => {
    const queryClient = useQueryClient();
    const restoreMutation = useMutation({
      mutationFn: async () => {
        const { error: DeleteError } = await supabase
          .from("trash")
          .delete()
          .eq("id", thread.id);
        if (DeleteError) {
          console.error("🚀 ~ removeThread ~ error", DeleteError);
          return;
        }
        const { data, error } = await supabase.from("new-threads").insert([
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
      },
      onSettled: async () => {
        return await queryClient.invalidateQueries({
          queryKey: ["trash"],
        });
      },
    });

    return (
      <Button
        size={`sm`}
        disabled={restoreMutation.isPending}
        onClick={async (e) => {
          e.stopPropagation();
          restoreMutation.mutate();
        }}
      >
        {restoreMutation.isPending ? "Restoring..." : "Restore"}
      </Button>
    );
  };

  return (
    <div className="container mx-auto p-4">
      <div className="flex flex-col gap-2">
        {isLoading && <ThreadLoading />}
        <AnimatePresence>
          {data?.map((thread) => (
            <DefaultThreadItem
              key={thread.id}
              thread={thread}
              threadName="trash"
              disablePrimaryAction
              extraButtons={<RestoreButton thread={thread} />}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

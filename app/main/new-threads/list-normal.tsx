import type { ThreadItemType } from "@/lib/typeDefs";
import { AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";
import { Card, CardHeader } from "@/components/ui/card";
import { useCallback, useEffect } from "react";

export const NormalThreads = () => {
  const fetchCollections = useCallback(async () => {
    try {
      const response = await fetch("/api/raindrop/collection");
      const data = await response.json();
      console.log(data);
    } catch (error) {
      console.error("Error fetching collections:", error);
    }
  }, []);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

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

  return (
    <div className="flex flex-col gap-2">
      <Card>
        <CardHeader>
          <div className="flex">
            <div className="flex-1 text-center">
              <h5>Battlepage</h5>
              <span className="font-bold text-2xl md:text-5xl">
                {
                  normalThreads?.filter(
                    (thread) => thread.type === "battlepage"
                  ).length
                }
              </span>
            </div>
            <div className="flex-1 text-center">
              <h5>Fmkorea</h5>
              <span className="font-bold text-2xl md:text-5xl">
                {
                  normalThreads?.filter((thread) => thread.type === "fmkorea")
                    .length
                }
              </span>
            </div>
            <div className="flex-1 text-center">
              <h5>ETC</h5>
              <span className="font-bold text-2xl md:text-5xl">
                {
                  normalThreads?.filter((thread) => thread.type === "normal")
                    .length
                }
              </span>
            </div>
          </div>
        </CardHeader>
      </Card>
      {isLoading && <ThreadLoading />}
      <AnimatePresence>
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

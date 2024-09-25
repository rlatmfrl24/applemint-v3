"use client";

import { ThreadItemType } from "@/lib/typeDefs";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/utils/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { useNewThreadsStore } from "@/store/new-threads.store";
import { NormalThreads } from "./list-normal";
import { YoutubeThreads } from "./list-youtube";

export const NewThreads = () => {
  const supabase = createClient();
  const threadStore = useNewThreadsStore();
  const [isLoading, setIsLoading] = useState(false);

  const getThreads = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("new-threads")
      .select()
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    const threadItems = data as ThreadItemType[];

    if (error) {
      console.error(error);
    }

    threadStore.setThreadItems(threadItems);
    setIsLoading(false);
  }, [supabase]);

  useEffect(() => {
    getThreads();
  }, [getThreads]);

  useEffect(() => {
    const channels = supabase
      .channel("new-threads-delete-channel")
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "new-threads" },
        (payload) => {
          console.log("🚀 ~ useEffect ~ payload:", payload);
          threadStore.removeThread(payload.old.id);
        }
      )
      .subscribe();
    return () => {
      channels.unsubscribe();
    };
  }, [supabase]);

  return (
    <div className="max-h-full h-full flex flex-col">
      {!isLoading ? (
        <div className="h-full flex flex-col">
          <div className="flex-1 overflow-auto">
            {
              {
                normal: (
                  <NormalThreads
                    threadItems={threadStore.threadItems.filter((thread) => {
                      return (
                        thread.type === "normal" ||
                        thread.type === "battlepage" ||
                        thread.type === "fmkorea"
                      );
                    })}
                  />
                ),
                media: <div>Image</div>,
                youtube: (
                  <YoutubeThreads
                    threadItems={threadStore.threadItems.filter((thread) => {
                      return thread.type === "youtube";
                    })}
                  />
                ),
              }[threadStore.selectedThreadType]
            }
          </div>
        </div>
      ) : (
        <>
          <Skeleton className="h-[125px] w-[250px] rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-4 w-[200px]" />
          </div>
        </>
      )}
    </div>
  );
};

"use client";

import { ThreadItemType } from "@/lib/typeDefs";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/utils/supabase/client";
import { useCallback, useEffect, useState } from "react";
import { useNewThreadsStore } from "@/store/new-threads.store";
import { NormalThreads } from "./list-normal";
import { YoutubeThreads } from "./list-youtube";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { MediaThreads } from "./list-media";

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
    <div className="max-h-full h-full flex flex-col border-t border-t-black dark:border-t-white">
      {!isLoading ? (
        <div className="h-full flex flex-col">
          <div className="flex-1 overflow-auto pt-2">
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
                media: (
                  <MediaThreads
                    threadItems={threadStore.threadItems.filter((thread) => {
                      return thread.type === "media";
                    })}
                  />
                ),
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
        <div className="space-y-2 pt-4">
          <Card>
            <CardContent className="space-y-2 mt-6">
              <Skeleton className="h-5 w-[250px] rounded-xl" />
              <Skeleton className="h-4 w-[250px]" />
              <Skeleton className="h-4 w-[200px]" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 mt-6">
              <Skeleton className="h-5 w-[250px] rounded-xl" />
              <Skeleton className="h-4 w-[250px]" />
              <Skeleton className="h-4 w-[200px]" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 mt-6">
              <Skeleton className="h-5 w-[250px] rounded-xl" />
              <Skeleton className="h-4 w-[250px]" />
              <Skeleton className="h-4 w-[200px]" />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

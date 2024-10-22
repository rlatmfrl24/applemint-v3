"use client";

import { ThreadItemType } from "@/lib/typeDefs";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/utils/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNewThreadsStore } from "@/store/new-threads.store";
import { NormalThreads } from "./list-normal";
import { YoutubeThreads } from "./list-youtube";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { MediaThreads } from "./list-media";

export const NewThreads = () => {
  const supabase = createClient();
  const threadStore = useNewThreadsStore();
  const [isLoading, setIsLoading] = useState(false);

  const currentThreadItems = useMemo(() => {
    return threadStore.threadItems.filter((thread) => {
      switch (threadStore.selectedThreadType) {
        case "normal":
          return (
            thread.type === "normal" ||
            thread.type === "battlepage" ||
            thread.type === "fmkorea"
          );
        case "media":
          return thread.type === "media";
        case "youtube":
          return thread.type === "youtube";
        default:
          return true;
      }
    });
  }, [threadStore.threadItems, threadStore.selectedThreadType]);

  const getThreads = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("new-threads")
      .select()
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    const threadItems = data as ThreadItemType[];

    console.log("🚀 ~ getThreads ~ threadItems", threadItems.length);

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
    <div className="w-full flex flex-col flex-1">
      <div className="w-full border-b border-b-black dark:border-b-white">
        <h2>{`Items: ${currentThreadItems.length}`}</h2>
      </div>
      {!isLoading ? (
        <div className="flex flex-col flex-1 basis-0 overflow-auto">
          <div className="flex-1 pt-2">
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

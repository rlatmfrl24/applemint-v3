"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThreadItemType } from "@/lib/typeDefs";
import { useNewThreadsStore } from "@/store/new-threads.store";
import { createClient } from "@/utils/supabase/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NormalThreads } from "./list-normal";
import { MediaThreads } from "./list-media";
import { YoutubeThreads } from "./list-youtube";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserStore } from "@/store/user.store";
import { redirect } from "next/navigation";

export function NewThreads() {
  const supabase = createClient();
  const threadStore = useNewThreadsStore();
  const userStore = useUserStore();
  const [currentThreadType, setCurrentThreadType] = useState("normal");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    //if user is not logged in, redirect to login page
    if (!userStore.isUserLoggedIn) {
      redirect("/login");
    }
  }, []);

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

  return (
    <>
      <h5 className="self-start m-2">{`Items: ${
        threadStore.threadItems.filter((thread) => {
          switch (currentThreadType) {
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
              return false;
          }
        }).length
      }`}</h5>
      <Tabs
        defaultValue={currentThreadType}
        className="w-full"
        onValueChange={(value) => {
          console.log("🚀 ~ Threads ~ value:", value);
          setCurrentThreadType(value);
        }}
      >
        <TabsList className="grid grid-cols-3 gap-2 w-full">
          <TabsTrigger value="normal">Normal</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
          <TabsTrigger value="youtube">Youtube</TabsTrigger>
        </TabsList>
        <TabsContent value="normal">
          {isLoading ? (
            <ThreadsLoading />
          ) : (
            <NormalThreads
              threadItems={threadStore.threadItems.filter((thread) => {
                return (
                  thread.type === "normal" ||
                  thread.type === "battlepage" ||
                  thread.type === "fmkorea"
                );
              })}
            />
          )}
        </TabsContent>
        <TabsContent value="media">
          {isLoading ? (
            <ThreadsLoading />
          ) : (
            <MediaThreads
              threadItems={threadStore.threadItems.filter(
                (thread) => thread.type === "media"
              )}
            />
          )}
        </TabsContent>
        <TabsContent value="youtube">
          {isLoading ? (
            <ThreadsLoading />
          ) : (
            <YoutubeThreads
              threadItems={threadStore.threadItems.filter(
                (thread) => thread.type === "youtube"
              )}
            />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

const ThreadsLoading = () => {
  return (
    <div className="space-y-2 pt-2">
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
  );
};

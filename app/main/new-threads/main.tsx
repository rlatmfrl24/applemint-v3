"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewThreadsStore } from "@/store/new-threads.store";
import { useEffect, useState } from "react";
import { NormalThreads } from "./list-normal";
import { MediaThreads } from "./list-media";
import { YoutubeThreads } from "./list-youtube";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function NewThreads() {
  const threadStore = useNewThreadsStore();
  const queryClient = new QueryClient();
  const [currentThreadType, setCurrentThreadType] = useState("normal");

  return (
    <>
      <QueryClientProvider client={queryClient}>
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
            <NormalThreads />
          </TabsContent>
          <TabsContent value="media">
            <MediaThreads />
          </TabsContent>
          <TabsContent value="youtube">
            <YoutubeThreads />
          </TabsContent>
        </Tabs>
      </QueryClientProvider>
    </>
  );
}

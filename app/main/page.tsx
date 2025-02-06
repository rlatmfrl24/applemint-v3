"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { NormalThreads } from "./new-threads/list-normal";
import { MediaThreads } from "./new-threads/list-media";
import { YoutubeThreads } from "./new-threads/list-youtube";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function MainPage() {
  const queryClient = new QueryClient();
  const [currentThreadType, setCurrentThreadType] = useState("normal");

  return (
    <>
      <QueryClientProvider client={queryClient}>
        <Tabs
          defaultValue={currentThreadType}
          className="w-full"
          onValueChange={(value) => {
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

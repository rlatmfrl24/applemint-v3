"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ThreadItemType } from "@/lib/typeDefs";

export const ThreadItem = ({ thread }: { thread: ThreadItemType }) => {
  return (
    <Card
      key={thread.id}
      className="cursor-pointer max-w-full w-full dark:hover:bg-zinc-800 hover:bg-zinc-100 transition-colors duration-200"
      onClick={() => {
        window.open(thread.url, "_blank");
      }}
    >
      <CardHeader className="max-w-full">
        <CardTitle className="max-w-full w-full text-ellipsis overflow-hidden">
          {thread.title}
        </CardTitle>
        <CardDescription>{thread.url}</CardDescription>
      </CardHeader>
    </Card>
  );
};

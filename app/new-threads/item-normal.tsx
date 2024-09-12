"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";

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
      <CardFooter>
        <Button
          size={`sm`}
          onClick={(e) => {
            e.stopPropagation();
            console.log("Remove button clicked");
          }}
        >
          Remove
        </Button>
      </CardFooter>
    </Card>
  );
};

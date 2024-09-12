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
      className="cursor-pointer max-w-full"
      //   onClick={() => {
      //     window.open(thread.url, "_blank");
      //   }}
    >
      <CardHeader>
        <CardTitle>{thread.title}</CardTitle>
        <CardDescription>{thread.url}</CardDescription>
      </CardHeader>
    </Card>
  );
};

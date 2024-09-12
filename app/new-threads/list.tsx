"use client";
import { Button } from "@/components/ui/button";
import { ThreadItem } from "./item";
import { ThreadItemType } from "@/lib/typeDefs";
import { useState } from "react";

export const NewThreadsList = ({
  threadItems,
}: {
  threadItems: ThreadItemType[];
}) => {
  const [selectedType, setSelectedType] = useState("normal");

  return (
    <div className="h-full  flex flex-col">
      <div className="flex items-center mb-3 gap-2">
        <Button
          size={`sm`}
          variant={selectedType === "normal" ? `default` : `ghost`}
          onClick={() => setSelectedType("normal")}
        >
          Normal
        </Button>
        <Button
          size={`sm`}
          variant={selectedType === "image" ? `default` : `ghost`}
          onClick={() => setSelectedType("image")}
        >
          Image
        </Button>
        <Button
          size={`sm`}
          variant={selectedType === "youtube" ? `default` : `ghost`}
          onClick={() => setSelectedType("youtube")}
        >
          Youtube
        </Button>
      </div>
      <div className="flex-1 flex flex-col gap-2 overflow-auto">
        {threadItems
          ?.filter((thread) => {
            switch (selectedType) {
              case "normal":
                return (
                  thread.type === "normal" ||
                  thread.type === "battlepage" ||
                  thread.type === "fmkorea"
                );
              case "image":
                return thread.type === "media";
              case "youtube":
                return thread.type === selectedType;
            }
          })
          .map((thread) => (
            <ThreadItem key={thread.id} thread={thread} />
          ))}
      </div>
    </div>
  );
};

"use client";
import { Button } from "@/components/ui/button";
import { ThreadItem } from "./item-normal";
import { ThreadItemType } from "@/lib/typeDefs";
import { useState } from "react";
import { NormalThreads } from "./list-normal";
import { YoutubeThreads } from "./list-youtube";

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
      <div className="flex-1 overflow-auto">
        {
          {
            normal: (
              <NormalThreads
                threadItems={threadItems.filter((thread) => {
                  return (
                    thread.type === "normal" ||
                    thread.type === "battlepage" ||
                    thread.type === "fmkorea"
                  );
                })}
              />
            ),
            image: <div>Image</div>,
            youtube: (
              <YoutubeThreads
                threadItems={threadItems.filter((thread) => {
                  return thread.type === "youtube";
                })}
              />
            ),
          }[selectedType]
        }
      </div>
    </div>
  );
};

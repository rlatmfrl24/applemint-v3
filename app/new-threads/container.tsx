"use client";

import { Button } from "@/components/ui/button";
import { ThreadItemType } from "@/lib/typeDefs";
import { useEffect, useState } from "react";
import { NormalThreads } from "./list-normal";
import { YoutubeThreads } from "./list-youtube";
import { createClient } from "@/utils/supabase/client";

export const NewThreadsList = ({
  threadItems,
}: {
  threadItems: ThreadItemType[];
}) => {
  const [selectedType, setSelectedType] = useState("normal");
  const [currentThreadItems, setCurrentThreadItems] = useState(threadItems);
  const supabase = createClient();

  useEffect(() => {
    const channels = supabase
      .channel("new-threads-delete-channel")
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "new-threads" },
        (payload) => {
          console.log("Change received!", payload);
          setCurrentThreadItems((prev) =>
            prev.filter((thread) => thread.id !== payload.old.id)
          );
        }
      )
      .subscribe();
    return () => {
      channels.unsubscribe();
    };
  }, [supabase]);

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
                threadItems={currentThreadItems.filter((thread) => {
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
                threadItems={currentThreadItems.filter((thread) => {
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

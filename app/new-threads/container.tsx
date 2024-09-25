"use client";

import { Button } from "@/components/ui/button";
import { ThreadItemType } from "@/lib/typeDefs";
import { useEffect, useState } from "react";
import { NormalThreads } from "./list-normal";
import { YoutubeThreads } from "./list-youtube";
import { createClient } from "@/utils/supabase/client";
import { useNewThreadsStore } from "@/store/new-threads.store";

export const NewThreadsList = ({
  threadItems,
}: {
  threadItems: ThreadItemType[];
}) => {
  const store = useNewThreadsStore();
  // const [selectedType, setSelectedType] = useState("normal");
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
            media: <div>Image</div>,
            youtube: (
              <YoutubeThreads
                threadItems={currentThreadItems.filter((thread) => {
                  return thread.type === "youtube";
                })}
              />
            ),
          }[store.selectedThreadType]
        }
      </div>
    </div>
  );
};

"use client";

import { DefaultThreadItem } from "@/components/thread-item";
import { Button } from "@/components/ui/button";
import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

export default function TrashThread() {
  //TODO: implement this function

  const supabase = createClient();
  const [trashThreads, setTrashThreads] = useState<ThreadItemType[] | null>(
    null
  );

  useEffect(() => {
    const fetchTrashThreads = async () => {
      const { data, error } = await supabase
        .from("trash")
        .select()
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      console.log("🚀 ~ getTrashThreads ~ data", data);

      if (error) {
        console.error(error);
      }

      setTrashThreads(data);
    };
    fetchTrashThreads();
  }, [supabase]);

  const RestoreButton = ({ thread }: { thread: ThreadItemType }) => {
    const [isMoving, setIsMoving] = useState(false);

    return (
      <Button
        size={`sm`}
        onClick={async (e) => {
          e.stopPropagation();
          setIsMoving(true);

          const { error: DeleteError } = await supabase
            .from("trash")
            .delete()
            .eq("id", thread.id);
          if (DeleteError) {
            console.error("🚀 ~ removeThread ~ error", DeleteError);
            return;
          }

          const { data, error: moveError } = await supabase
            .from("new-threads")
            .insert([
              {
                type: thread.type,
                url: thread.url,
                title: thread.title,
                description: thread.description,
                host: thread.host,
              },
            ]);

          if (moveError) {
            console.error("🚀 ~ removeThread ~ error", moveError);
            return;
          }

          //remove from treads
          setTrashThreads((prev) =>
            prev
              ? prev.filter((prevThread) => prevThread.id !== thread.id)
              : null
          );

          setIsMoving(false);
        }}
      >
        Restore
      </Button>
    );
  };

  return (
    <div className="container mx-auto p-4">
      <h5 className="self-start m-2">{`Items: ${
        trashThreads?.length ?? 0
      }`}</h5>
      <div className="flex flex-col gap-2">
        <AnimatePresence>
          {trashThreads?.map((thread) => (
            <DefaultThreadItem
              key={thread.id}
              thread={thread}
              threadName="trash"
              disablePrimaryAction
              extraButtons={
                <>
                  <RestoreButton thread={thread} />
                </>
              }
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

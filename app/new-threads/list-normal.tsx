import { ThreadItemType } from "@/lib/typeDefs";
import { AnimatePresence } from "framer-motion";
import { DefaultThreadItem } from "@/components/ThreadItem";
import { Button } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ThreadLoading } from "@/components/ThreadLoading";

export const NormalThreads = () => {
  const supabase = createClient();

  const {
    data: normalThreads,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["new-threads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("new-threads")
        .select()
        .or("type.eq.normal,type.eq.fmkorea,type.eq.battlepage")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (error) {
        console.error(error);
      }

      return data as ThreadItemType[];
    },
  });

  const QuickSaveButton = ({ thread }: { thread: ThreadItemType }) => {
    const [isMoving, setIsMoving] = useState(false);

    return (
      <Button
        size={`sm`}
        variant={"ghost"}
        onClick={async (e) => {
          e.stopPropagation();
          setIsMoving(true);

          const { error: DeleteError } = await supabase
            .from("new-threads")
            .delete()
            .eq("id", thread.id);
          if (DeleteError) {
            console.error("🚀 ~ removeThread ~ error", DeleteError);
            return;
          }

          const { data, error: moveError } = await supabase
            .from("quick-save")
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

          setIsMoving(false);
        }}
      >
        Quick Save
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence>
        {isLoading && <ThreadLoading />}
        {normalThreads?.map((thread) => (
          <DefaultThreadItem
            key={thread.id}
            thread={thread}
            threadName="new-threads"
            extraButtons={
              <div>
                <QuickSaveButton thread={thread} />
              </div>
            }
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

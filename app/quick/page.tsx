"use client";

import { ThreadItem } from "@/components/ThreadItem";
import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { useEffect, useState } from "react";

export default function QuickThread() {
  const supabase = createClient();
  const [quickThreads, setQuickThreads] = useState<ThreadItemType[] | null>(
    null
  );

  useEffect(() => {
    const fetchQuickThreads = async () => {
      const { data, error } = await supabase
        .from("quick-save")
        .select()
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      console.log("🚀 ~ getQuickThreads ~ data", data);

      if (error) {
        console.error(error);
      }

      setQuickThreads(data);
    };
    fetchQuickThreads();
  }, [supabase]);

  return (
    <div className="container mx-auto p-4">
      <h5 className="self-start m-2">{`Items: ${
        quickThreads?.length ?? 0
      }`}</h5>
      <div className="flex flex-col gap-2">
        {quickThreads?.map((thread) => (
          <ThreadItem
            key={thread.id}
            thread={thread}
            threadName="quick-save"
            onDeleted={() => {
              setQuickThreads((prev) =>
                prev
                  ? prev.filter((prevThread) => prevThread.id !== thread.id)
                  : null
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}

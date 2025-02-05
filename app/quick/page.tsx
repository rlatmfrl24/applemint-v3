"use client";

import { DefaultThreadItem } from "@/components/ThreadItem";
import { ThreadItemType } from "@/lib/typeDefs";
import { useUserStore } from "@/store/user.store";
import { createClient } from "@/utils/supabase/client";
import { AnimatePresence } from "framer-motion";
import { redirect, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function QuickThread() {
  //TODO: implement this function

  const supabase = createClient();
  const userStore = useUserStore();

  const [quickThreads, setQuickThreads] = useState<ThreadItemType[] | null>(
    null
  );

  useEffect(() => {
    //if user is not logged in, redirect to login page
    if (!userStore.isUserLoggedIn) {
      redirect("/login");
    }
  }, []);

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
        <AnimatePresence>
          {quickThreads?.map((thread) => (
            <DefaultThreadItem
              key={thread.id}
              thread={thread}
              threadName="quick-save"
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

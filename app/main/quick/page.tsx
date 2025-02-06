"use client";

import { createClient } from "@/utils/supabase/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";

export default function QuickPage() {
  const queryClient = new QueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <QuickThread />
    </QueryClientProvider>
  );
}

const QuickThread = () => {
  const supabase = createClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["quick-save"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quick-save")
        .select()
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      return data;
    },
  });

  return (
    <>
      <div className="flex flex-col gap-2 w-full">
        {isLoading && <ThreadLoading />}
        <AnimatePresence>
          {data?.map((thread) => (
            <DefaultThreadItem
              key={thread.id}
              thread={thread}
              threadName="quick-save"
            />
          ))}
        </AnimatePresence>
      </div>
    </>
  );
};

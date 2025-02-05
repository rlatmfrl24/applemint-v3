"use client";

import { createClient } from "@/utils/supabase/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";

export const QuickThreadWrapper = () => {
  const queryClient = new QueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <QuickThread />
    </QueryClientProvider>
  );
};

const QuickThread = () => {
  const supabase = createClient();

  const { data } = useQuery({
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
      <div className="flex flex-col gap-2">
        {data?.map((thread: any) => (
          <div key={thread.id}>{thread.title}</div>
        ))}
      </div>
    </>
  );
};

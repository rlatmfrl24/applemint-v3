import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/server";
import { NewThreadsList } from "./container";
import { Skeleton } from "@/components/ui/skeleton";

export const NewThreads = async () => {
  const supabase = createClient();

  const { data, error } = await supabase.from("new-threads").select();
  const threadItems = data as ThreadItemType[];

  if (error) {
    console.error(error);
  }

  return (
    <div className="max-h-full h-full flex flex-col">
      {threadItems && threadItems.length > 0 ? (
        <NewThreadsList threadItems={threadItems} />
      ) : (
        <>
          <Skeleton className="h-[125px] w-[250px] rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-4 w-[200px]" />
          </div>
        </>
      )}
    </div>
  );
};

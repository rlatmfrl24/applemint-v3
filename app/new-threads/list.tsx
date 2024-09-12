import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/server";
import { ThreadItem } from "./item";
import { ScrollArea } from "@/components/ui/scroll-area";

export const NewThreads = async () => {
  const supabase = createClient();

  const { data, error } = await supabase.from("new-threads").select();
  const threadItems = data as ThreadItemType[];

  if (error) {
    console.error(error);
  }

  return (
    <>
      <div className="max-h-full overflow-y-auto overflow-x-hidden ">
        <div className="flex flex-col gap-2 ">
          {threadItems?.map((thread) => (
            <ThreadItem key={thread.id} thread={thread} />
          ))}
        </div>
      </div>
    </>
  );
};

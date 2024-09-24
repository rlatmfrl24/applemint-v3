import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";

export const ThreadItem = ({ thread }: { thread: ThreadItemType }) => {
  const removeThread = async (id: string) => {
    const supabase = createClient();
    const { error: DeleteError } = await supabase
      .from("new-threads")
      .delete()
      .eq("id", parseInt(id));
    if (DeleteError) {
      console.error("🚀 ~ removeThread ~ error", DeleteError);
      return;
    }

    const { data, error: TrashInsertError } = await supabase
      .from("trash")
      .insert([
        {
          type: thread.type,
          url: thread.url,
          title: thread.title,
          description: thread.description,
          host: thread.host,
        },
      ]);

    if (TrashInsertError) {
      console.error("🚀 ~ removeThread ~ error", TrashInsertError);
      return;
    }

    console.log("🚀 ~ removeThread ~ data", data);
  };

  return (
    <Card
      key={thread.id}
      className="cursor-pointer max-w-full w-full dark:hover:bg-zinc-800 hover:bg-zinc-100 transition-colors duration-200"
      onClick={() => {
        window.open(thread.url, "_blank");
      }}
    >
      <CardHeader className="max-w-full">
        <CardTitle className="max-w-full w-full text-ellipsis overflow-hidden">
          {thread.title}
        </CardTitle>
        <CardDescription>{thread.url}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          size={`sm`}
          onClick={async (e) => {
            e.stopPropagation();
            await removeThread(thread.id);
          }}
        >
          Remove
        </Button>
      </CardFooter>
    </Card>
  );
};

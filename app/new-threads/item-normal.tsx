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
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useState } from "react";

export const ThreadItem = ({ thread }: { thread: ThreadItemType }) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const removeThread = async (id: string) => {
    setIsDeleting(true);

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
    setIsDeleting(false);
  };

  return (
    <motion.div exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}>
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
            {!isDeleting ? "Remove" : <Loader2 className="animate-spin" />}
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
};

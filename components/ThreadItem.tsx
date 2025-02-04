import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { motion } from "framer-motion";
import { useState } from "react";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Button } from "./ui/button";
import { Loader2 } from "lucide-react";

export const DefaultThreadItem = ({
  thread,
  threadName,
  extraButtons,
  onDeleted,
  primaryButtonLabel,
}: {
  thread: ThreadItemType;
  threadName: string;
  extraButtons?: React.ReactNode;
  onDeleted?: () => void;
  primaryButtonLabel?: string;
}) => {
  const [isDeleting, setIsDeleting] = useState(false);

  async function moveThread(id: string, from: string, to: string) {
    const supabase = createClient();
    const { error: DeleteError } = await supabase
      .from(from)
      .delete()
      .eq("id", parseInt(id));
    if (DeleteError) {
      console.error("🚀 ~ removeThread ~ error", DeleteError);
      return;
    }

    const { data, error: moveError } = await supabase.from(to).insert([
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
  }

  return (
    <motion.div exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}>
      <Card
        key={thread.id}
        className="cursor-pointer max-w-full w-full
          hover:bg-zinc-200 dark:hover:bg-zinc-900
           transition-colors duration-200"
        onClick={() => {
          window.open(thread.url, "_blank");
        }}
      >
        <CardHeader className="max-w-full">
          <CardTitle className="max-w-full w-full text-ellipsis overflow-hidden">
            {thread.title}
          </CardTitle>
          <CardDescription className="max-w-full w-full text-ellipsis overflow-hidden">
            {thread.url}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex gap-2 items-center justify-between">
          <Button
            size={`sm`}
            onClick={async (e) => {
              e.stopPropagation();
              // await removeThread(thread.id);
              setIsDeleting(true);
              await moveThread(thread.id, threadName, "trash");
              setIsDeleting(false);
              onDeleted && onDeleted();
            }}
          >
            {!isDeleting ? (
              primaryButtonLabel || "Delete"
            ) : (
              <Loader2 className="animate-spin" />
            )}
          </Button>
          <div>{extraButtons}</div>
        </CardFooter>
      </Card>
    </motion.div>
  );
};

import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const DefaultThreadItem = ({
  thread,
  threadName,
  extraButtons,
  disablePrimaryAction,
}: {
  thread: ThreadItemType;
  threadName: string;
  extraButtons?: React.ReactNode;
  disablePrimaryAction?: boolean;
}) => {
  const queryClient = useQueryClient();

  const removeThread = useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error: DeleteError } = await supabase
        .from(threadName)
        .delete()
        .eq("id", parseInt(id));
      if (DeleteError) {
        console.error("🚀 ~ removeThread ~ error", DeleteError);
        return;
      }

      const { error: TrashInsertError } = await supabase.from("trash").insert([
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
    },
    onSettled: async () => {
      return await queryClient.invalidateQueries({
        queryKey: [threadName],
      });
    },
  });

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
          {disablePrimaryAction ? null : (
            <Button
              size={`sm`}
              onClick={async (e) => {
                e.stopPropagation();
                removeThread.mutate(thread.id);
              }}
            >
              {!removeThread.isPending ? (
                "Delete"
              ) : (
                <Loader2 className="animate-spin" />
              )}
            </Button>
          )}
          <div className="flex gap-2">
            {extraButtons}
            <Button
              size={`sm`}
              variant={`ghost`}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              Go to Raindrop
            </Button>
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
};

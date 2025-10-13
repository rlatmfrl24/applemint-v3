import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { useMoveThreadToTrash } from "./new-threads/use-move-to-trash";
import { useCallback } from "react";

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
        .eq("id", Number.parseInt(id));
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

  const moveNewThreadToTrash = useMoveThreadToTrash(thread);
  const isNewThreadsScope = threadName === "new-threads";

  const isDeleting = isNewThreadsScope
    ? moveNewThreadToTrash.isPending
    : removeThread.isPending;

  const handleDelete = useCallback(() => {
    const idAsString = String(thread.id);

    if (isNewThreadsScope) {
      moveNewThreadToTrash.mutate(idAsString);
      return;
    }

    removeThread.mutate(idAsString);
  }, [isNewThreadsScope, moveNewThreadToTrash, removeThread, thread.id]);

  return (
    <Card
      className="w-full max-w-full cursor-pointer transition-colors duration-200 hover:bg-zinc-200 dark:hover:bg-zinc-900"
      onClick={() => {
        window.open(thread.url, "_blank");
      }}
    >
      <CardHeader className="max-w-full">
        <CardTitle className="w-full max-w-full overflow-hidden text-ellipsis">
          {thread.title || "Untitled"}
        </CardTitle>
        <CardDescription className="w-full max-w-full overflow-hidden text-ellipsis">
          {thread.url}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex items-center justify-between gap-2">
        {disablePrimaryAction ? null : (
          <div className="flex items-center gap-2">
            <Button
              disabled={isDeleting}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
            >
              {!isDeleting ? "Delete" : <Loader2 className="animate-spin" />}
            </Button>
          </div>
        )}
        <div
          className="flex gap-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {extraButtons}
          <Button
            variant={"outline"}
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(thread.url);
              toast("Link copied to clipboard");
            }}
          >
            Copy Link
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};

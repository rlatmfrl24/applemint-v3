import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export const MediaItem = ({
  thread,
  onClick,
}: {
  thread: ThreadItemType;
  onClick: (url: ThreadItemType) => void;
}) => {
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
    <Card
      key={thread.id}
      className="cursor-pointer max-w-full w-full flex flex-col dark:hover:bg-zinc-800 hover:bg-zinc-100 transition-colors duration-200"
      onClick={() => onClick(thread)}
    >
      <CardHeader>
        <CardTitle className="max-w-full w-full text-ellipsis overflow-hidden whitespace-nowrap">
          {thread.title || "Untitled"}
        </CardTitle>
        <CardDescription className="max-w-full w-full text-ellipsis overflow-hidden">
          {thread.url}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          size={"sm"}
          onClick={async (e) => {
            e.stopPropagation();
            setIsDeleting(true);
            await removeThread(thread.id);
            setIsDeleting(false);
          }}
        >
          {isDeleting ? <Loader2 className="animate-spin" /> : "Delete"}
        </Button>
      </CardFooter>
    </Card>
  );
};

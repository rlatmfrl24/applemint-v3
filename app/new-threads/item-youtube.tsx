import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";

function getYoutubeId(url: string) {
  // get youtube video id from short url
  const regExp =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

export const YoutubeItem = ({ thread }: { thread: ThreadItemType }) => {
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
      className="cursor-pointer max-w-full w-full dark:hover:bg-zinc-800 hover:bg-zinc-100 transition-colors duration-200"
      onClick={() => {
        window.open(thread.url, "_blank");
      }}
    >
      <CardHeader>
        <CardTitle className="whitespace-nowrap text-ellipsis overflow-hidden ">
          <div className="mb-2">
            {thread.title.length === 0 || thread.title === thread.url
              ? "Untitled"
              : thread.title}
          </div>
          {getYoutubeId(thread.url) ? (
            <Image
              src={`https://img.youtube.com/vi/${getYoutubeId(
                thread.url
              )}/0.jpg`}
              alt={thread.title}
              className="w-full h-56 object-cover"
              width={0}
              height={0}
              sizes="100vw"
            />
          ) : (
            <div className="w-full h-56">Empty</div>
          )}
        </CardTitle>
        <CardDescription className="whitespace-nowrap text-ellipsis overflow-hidden max-w-full">
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

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
  CardContent,
} from "@/components/ui/card";
import { ThreadItemType } from "@/lib/typeDefs";
import { motion } from "framer-motion";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";

export const MediaItem = ({ thread }: { thread: ThreadItemType }) => {
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

  const images = async (url: string) => {
    if (url.includes("imgur")) {
      if (url.includes("/a/")) {
        const albumId = url.split("/a/")[1];
        console.log("🚀 ~ images ~ albumId", albumId);
        const response = await fetch(
          `https://api.imgur.com/3/album/${albumId}/images`,
          {
            headers: {
              Authorization: `Client-ID ${process.env.NEXT_PUBLIC_IMGUR_CLIENT_ID}`,
            },
          }
        );
        const data = await response.json();
        const images = data.data.images.map((image: any) => image.link);
        return images;
      } else {
        return [url.replace("imgur.com", "i.imgur.com")];
      }
    } else {
      return [url];
    }
  };

  return (
    <Card
      key={thread.id}
      className="cursor-pointer max-w-full w-full h-full flex flex-col dark:hover:bg-zinc-800 hover:bg-zinc-100 transition-colors duration-200"
      onClick={async () => {
        try {
          const a = await images(thread.url);
          console.log("🚀 ~ images ~ images:", a);
        } catch (error) {
          window.open(thread.url, "_blank");
        }
      }}
    >
      <CardHeader>
        <CardTitle className="max-w-full w-full text-ellipsis overflow-hidden whitespace-nowrap">
          {thread.title || "Untitled"}
        </CardTitle>
        <CardDescription className="max-w-full w-full text-ellipsis overflow-hidden">
          {thread.url}
        </CardDescription>
      </CardHeader>
    </Card>
  );
};

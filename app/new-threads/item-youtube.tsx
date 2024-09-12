import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThreadItemType } from "@/lib/typeDefs";
import Image from "next/image";

function getYoutubeId(url: string) {
  // get youtube video id from short url
  const regExp =
    /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

export const YoutubeItem = ({ thread }: { thread: ThreadItemType }) => {
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
        <CardDescription className="whitespace-nowrap text-ellipsis overflow-hidden">
          {thread.url}
        </CardDescription>
      </CardHeader>
    </Card>
  );
};

import { ThreadItemType } from "@/lib/typeDefs";
import { MediaItem } from "./item-media";
import { Button } from "@/components/ui/button";

async function getThumbnail(url: string) {
  // case 1: direct image url
  if (url.match(/\.(jpeg|jpg|gif|png)$/) != null) {
    return url;
  }

  // case 2: direct video url
  if (url.match(/\.(mp4|webm)$/) != null) {
    return null;
  }

  // case 3: imgur album
  if (url.match(/imgur.com\/a\//) != null) {
    const albumId = url.split("/")[url.split("/").length - 1];
    return `https://imgur.com/a/${albumId}/cover`;
  }

  // case 4: imgur image
  if (url.match(/imgur.com\/[^/]+$/) != null) {
    return null;
  }

  // case 5: etc
}

export const MediaThreads = ({
  threadItems,
}: {
  threadItems: ThreadItemType[];
}) => {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 md:grid md:grid-cols-2 lg:grid-cols-4">
        {threadItems.map((thread) => (
          <MediaItem key={thread.id} thread={thread} />
        ))}
      </div>
    </div>
  );
};

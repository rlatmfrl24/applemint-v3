import { MediaItemType, ThreadItemType } from "@/lib/typeDefs";
import { MediaItem } from "./item-media";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Image from "next/image";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

async function getMediaData(item: ThreadItemType) {
  // case 1: direct image url
  if (item.url.match(/\.(jpeg|jpg|gif|png)$/) != null) {
    return [item.url];
  }

  // case 2: direct video url
  if (item.url.match(/\.(mp4|webm)$/) != null) {
    return [item.url];
  }

  // case 3: imgur album
  if (item.url.match(/imgur.com\/a\//) != null) {
    const albumId = item.url.split("/")[item.url.split("/").length - 1];
    const response = await fetch(`/api/imgur?type=album&id=${albumId}`);
    const data = await response.json();

    console.log("🚀 ~ getMediaData ~ data", data);
    return data.data.images.map((img: any) => img.link);
  }

  // case 4: imgur image
  if (item.url.match(/imgur.com\/[^/]+$/) != null) {
    const imageId = item.url.split("/")[item.url.split("/").length - 1];
    const response = await fetch(`/api/imgur?type=normal&id=${imageId}`);
    const data = await response.json();

    console.log("🚀 ~ getMediaData ~ data", data);
    return [data.data.link];
  }

  // case 5: etc
  return [];
}

export const MediaThreads = ({
  threadItems,
}: {
  threadItems: ThreadItemType[];
}) => {
  const [items, setItems] = useState<MediaItemType[]>(
    threadItems as MediaItemType[]
  );
  const [selectedItem, setSelectedItem] = useState<MediaItemType | null>(null);

  useEffect(() => {
    setItems(
      threadItems.map((item) => {
        const hasMediaItem = items.find((i) => i.id === item.id);
        if (hasMediaItem) return hasMediaItem;
        else return item;
      }) as MediaItemType[]
    );
  }, [threadItems]);

  return (
    <div className="flex gap-2 max-w-full">
      <div className="flex flex-col gap-2 flex-1 w-1/2">
        {items.map((thread) => (
          <MediaItem
            key={thread.id}
            thread={thread}
            onClick={async (item) => {
              const selectedMedia = items.find((i) => i.id === item.id);

              console.log("🚀 ~ selectedMedia", selectedMedia);

              if (
                selectedMedia &&
                selectedMedia.media &&
                selectedMedia.media.length > 0
              ) {
                setSelectedItem(selectedMedia);
              } else {
                const media = await getMediaData(item);

                if (!media) {
                  // open new tab
                  window.open(item.url, "_blank");
                }

                setSelectedItem({
                  ...item,
                  media: media ? media : null,
                });

                setItems((prev) =>
                  prev.map((prevItem) =>
                    prevItem.id === item.id
                      ? {
                          ...prevItem,
                          media: media ? media : null,
                        }
                      : prevItem
                  )
                );
              }
            }}
          />
        ))}
      </div>
      <div className="flex-1 h-fit sticky top-2">
        <PinnedMedia item={selectedItem} />
      </div>
    </div>
  );
};

const PinnedMedia = ({ item }: { item: MediaItemType | null }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{item ? item.title : "No Item Selected"}</CardTitle>
        <CardDescription>{item?.url}</CardDescription>
      </CardHeader>
      <CardContent>
        <AspectRatio ratio={16 / 9}>
          {item?.media?.map((media) => {
            // media is image
            if (media.match(/\.(jpeg|jpg|gif|png)$/) != null) {
              return (
                <Image
                  key={media}
                  src={media}
                  alt=""
                  width={0}
                  height={0}
                  sizes="100vw"
                  data-loaded="false"
                  onLoad={(event) => {
                    event.currentTarget.setAttribute("data-loaded", "true");
                  }}
                  className="object-contain rounded-md w-full h-full data-[loaded=false]:animate-pulse data-[loaded=false]:bg-gray-100/10"
                />
              );
            }
            // media is video
            if (media.match(/\.(mp4|webm)$/) != null) {
              return (
                <video
                  key={media}
                  src={media}
                  controls
                  width={0}
                  height={0}
                  className="object-contain rounded-md w-full h-full"
                />
              );
            }
          })}
          {(item?.media?.length === 0 || item === null) && (
            <Alert className="h-full">
              <AlertTitle>No Media</AlertTitle>
              <AlertDescription>
                Please select an item to view media or open the link in a new
                tab.
              </AlertDescription>
            </Alert>
          )}
        </AspectRatio>
      </CardContent>
    </Card>
  );
};

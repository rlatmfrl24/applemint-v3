import { MediaItemType, ThreadItemType } from "@/lib/typeDefs";
import { MediaItem } from "./item-media";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { get } from "http";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Image from "next/image";
import { AspectRatio } from "@/components/ui/aspect-ratio";

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

      const response = await fetch(`https://api.imgur.com/3/album/${albumId}`, {
        headers: {
          Authorization: `Client-ID ${process.env.NEXT_PUBLIC_IMGUR_CLIENT_ID}`,
        },
      });

      const data = await response.json();

      console.log("🚀 ~ getMediaData ~ data", data);
      return data.data.images.map((img: any) => img.link);
    }

    // case 4: imgur image
    if (item.url.match(/imgur.com\/[^/]+$/) != null) {
      const imageId = item.url.split("/")[item.url.split("/").length - 1];

      const response = await fetch(`https://api.imgur.com/3/image/${imageId}`, {
        headers: {
          Authorization: `Client-ID ${process.env.NEXT_PUBLIC_IMGUR_CLIENT_ID}`,
        },
      });

      const data = await response.json();

      console.log("🚀 ~ getMediaData ~ data", data);
      return [data.data.link];
    }

    // case 5: etc
    return null;
  }

  const [items, setItems] = useState<MediaItemType[]>(
    threadItems as MediaItemType[]
  );
  const [selectedItem, setSelectedItem] = useState<MediaItemType | null>(null);

  useEffect(() => {
    console.log("🚀 ~ MediaThreads ~ items", selectedItem);
  }, [selectedItem]);

  return (
    <div className="flex gap-2 max-w-full">
      <div className="flex flex-col gap-2 flex-1 w-1/2">
        {items.map((thread) => (
          <MediaItem
            key={thread.id}
            thread={thread}
            onClick={async (item) => {
              const selectedMedia = items.find((i) => i.id === item.id);

              if (selectedMedia && selectedMedia.media) {
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
        <Card>
          <CardHeader>
            <CardTitle>{selectedItem?.title}</CardTitle>
            <CardDescription>{selectedItem?.url}</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedItem?.media?.map((media) => {
              // media is image
              if (media.match(/\.(jpeg|jpg|gif|png)$/) != null) {
                return (
                  <AspectRatio ratio={16 / 9}>
                    <Image
                      key={media}
                      src={media}
                      alt=""
                      width={0}
                      height={0}
                      sizes="100vw"
                      className="object-contain rounded-md w-full h-full"
                    />
                  </AspectRatio>
                );
              }
              // media is video
              if (media.match(/\.(mp4|webm)$/) != null) {
                return (
                  <AspectRatio ratio={16 / 9}>
                    <video
                      key={media}
                      src={media}
                      controls
                      width={0}
                      height={0}
                      className="object-contain rounded-md w-full h-full"
                    />
                  </AspectRatio>
                );
              }
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

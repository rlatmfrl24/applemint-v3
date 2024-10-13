import { ThreadItemType } from "@/lib/typeDefs";
import { MediaItem } from "./item-media";
import { Button } from "@/components/ui/button";

export const MediaThreads = ({
  threadItems,
}: {
  threadItems: ThreadItemType[];
}) => {
  return (
    <div className="space-y-2">
      <Button size={"sm"}>Clear</Button>
      <div className="flex flex-col gap-2 md:grid md:grid-cols-2 lg:grid-cols-4">
        {threadItems.map((thread) => (
          <MediaItem key={thread.id} thread={thread} />
        ))}
      </div>
    </div>
  );
};

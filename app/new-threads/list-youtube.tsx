import { ThreadItemType } from "@/lib/typeDefs";
import { YoutubeItem } from "./item-youtube";

export const YoutubeThreads = ({
  threadItems,
}: {
  threadItems: ThreadItemType[];
}) => {
  //TODO: implement this function

  return (
    <div className="flex flex-col gap-2 md:grid md:grid-cols-2 lg:grid-cols-3">
      {threadItems.map((thread) => (
        <YoutubeItem key={thread.id} thread={thread} />
      ))}
    </div>
  );
};

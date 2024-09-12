import { ThreadItemType } from "@/lib/typeDefs";
import { ThreadItem } from "./item-normal";

export const NormalThreads = ({
  threadItems,
}: {
  threadItems: ThreadItemType[];
}) => {
  return (
    <div className="flex flex-col gap-2">
      {threadItems.map((thread) => (
        <ThreadItem key={thread.id} thread={thread} />
      ))}
    </div>
  );
};

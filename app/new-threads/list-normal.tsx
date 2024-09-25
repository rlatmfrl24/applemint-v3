import { ThreadItemType } from "@/lib/typeDefs";
import { ThreadItem } from "./item-normal";
import { AnimatePresence } from "framer-motion";

export const NormalThreads = ({
  threadItems,
}: {
  threadItems: ThreadItemType[];
}) => {
  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence>
        {threadItems.map((thread) => (
          <ThreadItem key={thread.id} thread={thread} />
        ))}
      </AnimatePresence>
    </div>
  );
};

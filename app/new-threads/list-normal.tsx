import { ThreadItemType } from "@/lib/typeDefs";
import { AnimatePresence } from "framer-motion";
import { ThreadItem } from "@/components/ThreadItem";

export const NormalThreads = ({
  threadItems,
}: {
  threadItems: ThreadItemType[];
}) => {
  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence>
        {threadItems.map((thread) => (
          <ThreadItem
            key={thread.id}
            thread={thread}
            threadName="new-threads"
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

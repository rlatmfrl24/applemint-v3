"use client";

import { Button } from "@/components/ui/button";
import { useNewThreadsStore } from "@/store/new-threads.store";

export const ThreadsSelector = () => {
  const store = useNewThreadsStore();

  return (
    <div className="flex items-center gap-2 mb-4">
      <Button
        size={`sm`}
        variant={store.selectedThreadType === "normal" ? "default" : "ghost"}
        onClick={() => store.setSelectedThreadType("normal")}
      >
        Normal
      </Button>
      <Button
        size={`sm`}
        variant={store.selectedThreadType === "media" ? "default" : "ghost"}
        onClick={() => store.setSelectedThreadType("media")}
      >
        Image
      </Button>
      <Button
        size={`sm`}
        variant={store.selectedThreadType === "youtube" ? "default" : "ghost"}
        onClick={() => store.setSelectedThreadType("youtube")}
      >
        Youtube
      </Button>
    </div>
  );
};

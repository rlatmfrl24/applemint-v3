import { ThreadItemType } from "@/lib/typeDefs";
import { create } from "zustand/react";

interface NewThreadsState {
    selectedThreadType: "normal" | "media" | "youtube";
    threadItems: ThreadItemType[];
    setSelectedThreadType: (
        selectedThreadType: "normal" | "media" | "youtube",
    ) => void;
    removeThread: (id: string) => void;
    setThreadItems: (threadItems: ThreadItemType[]) => void;
}

export const useNewThreadsStore = create<NewThreadsState>((set) => ({
    selectedThreadType: "normal",
    threadItems: [],
    setSelectedThreadType: (selectedThreadType) => set({ selectedThreadType }),
    setThreadItems(threadItems) {
        set({ threadItems });
    },
    removeThread: (id: string) => {
        set((state) => ({
            ...state,
            threadItems: state.threadItems.filter((thread) => thread.id !== id),
        }));
    },
}));

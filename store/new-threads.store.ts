import { ThreadItemType } from "@/lib/typeDefs";
import { create } from "zustand/react";

interface NewThreadsState {
    threadItems: ThreadItemType[];
    removeThread: (id: string) => void;
    setThreadItems: (threadItems: ThreadItemType[]) => void;
}

export const useNewThreadsStore = create<NewThreadsState>((set) => ({
    threadItems: [],
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

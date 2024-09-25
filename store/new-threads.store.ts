import { create } from "zustand/react";

interface NewThreadsState {
    selectedThreadType: "normal" | "media" | "youtube";
    setSelectedThreadType: (
        selectedThreadType: "normal" | "media" | "youtube",
    ) => void;
}

export const useNewThreadsStore = create<NewThreadsState>((set) => ({
    selectedThreadType: "normal",
    setSelectedThreadType: (selectedThreadType) => set({ selectedThreadType }),
}));

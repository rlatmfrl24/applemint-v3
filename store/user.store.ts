import { create } from "zustand/react";

interface UserState {
    isUserLoggedIn: boolean;
    user: any;
    setIsUserLoggedIn: (isUserLoggedIn: boolean) => void;
    setUser: (user: any) => void;
}

export const useUserStore = create<UserState>((set) => ({
    isUserLoggedIn: false,
    user: null,
    setIsUserLoggedIn: (isUserLoggedIn: boolean) => {
        set({ isUserLoggedIn });
    },
    setUser: (user: any) => {
        set({ user });
    },
}));

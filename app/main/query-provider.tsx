"use client";

import { trackBookmarkHistory } from "@/lib/bookmark-history";
import { AppTRPCProvider } from "@/trpc/client";

if (typeof window !== "undefined") trackBookmarkHistory();

export function MainQueryProvider({ children }: { children: React.ReactNode }) {
	return <AppTRPCProvider>{children}</AppTRPCProvider>;
}

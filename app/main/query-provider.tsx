"use client";

import { AppTRPCProvider } from "@/trpc/client";

export function MainQueryProvider({ children }: { children: React.ReactNode }) {
	return <AppTRPCProvider>{children}</AppTRPCProvider>;
}

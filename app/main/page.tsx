"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { NormalThreads } from "./new-threads/list-normal";

export default function MainPage() {
	const [queryClient] = useState(() => new QueryClient());

	return (
		<QueryClientProvider client={queryClient}>
			<NormalThreads />
		</QueryClientProvider>
	);
}

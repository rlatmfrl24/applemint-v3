"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MediaThreads } from "./new-threads/list-media";
import { NormalThreads } from "./new-threads/list-normal";
import { YoutubeThreads } from "./new-threads/list-youtube";

export default function MainPage() {
	const [queryClient] = useState(() => new QueryClient());
	const [currentThreadType, setCurrentThreadType] = useState("normal");

	return (
		<QueryClientProvider client={queryClient}>
			<Tabs
				defaultValue={currentThreadType}
				className="w-full"
				onValueChange={(value) => {
					setCurrentThreadType(value);
				}}
			>
				<TabsList className="grid w-full grid-cols-3 gap-2">
					<TabsTrigger value="normal">Normal</TabsTrigger>
					<TabsTrigger value="media">Media</TabsTrigger>
					<TabsTrigger value="youtube">Youtube</TabsTrigger>
				</TabsList>
				<TabsContent value="normal">
					<NormalThreads isActive={currentThreadType === "normal"} />
				</TabsContent>
				<TabsContent value="media">
					<MediaThreads isActive={currentThreadType === "media"} />
				</TabsContent>
				<TabsContent value="youtube">
					<YoutubeThreads isActive={currentThreadType === "youtube"} />
				</TabsContent>
			</Tabs>
		</QueryClientProvider>
	);
}

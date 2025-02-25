import type { ThreadItemType } from "@/lib/typeDefs";
import { YoutubeItem } from "./item-youtube";
import { createClient } from "@/utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { ThreadLoading } from "../thread-loading";
import NoDataBox from "../no-data";

export const YoutubeThreads = () => {
	const supabase = createClient();

	const {
		data: youtubeThreads,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["new-threads"],
		queryFn: async () => {
			const { data, error } = await supabase
				.from("new-threads")
				.select()
				.eq("type", "youtube")
				.order("created_at", { ascending: false })
				.order("id", { ascending: false });

			if (error) {
				console.error(error);
			}

			return data as ThreadItemType[];
		},
	});

	return (
		<>
			{isLoading && <ThreadLoading />}
			{!isLoading && youtubeThreads?.length === 0 && <NoDataBox />}
			<div className="flex flex-col gap-2 md:grid md:grid-cols-2 lg:grid-cols-3">
				{youtubeThreads?.map((thread) => (
					<YoutubeItem key={thread.id} thread={thread} />
				))}
			</div>
		</>
	);
};

import type { MediaItemType } from "@/lib/typeDefs";
import { MediaItem } from "./item-media";
import { createClient } from "@/utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { ThreadLoading } from "../thread-loading";
import NoDataBox from "../no-data";

export const MediaThreads = () => {
	const supabase = createClient();

	const {
		data: mediaThreads,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["new-threads", "media"],
		queryFn: async () => {
			const { data, error } = await supabase
				.from("new-threads")
				.select()
				.eq("type", "media")
				.order("created_at", { ascending: false })
				.order("id", { ascending: false });

			if (error) {
				console.error(error);
			}

			return data as MediaItemType[];
		},
	});

	return (
		<div className="flex gap-2 max-w-full md:flex-row flex-col-reverse">
			{!isLoading && mediaThreads?.length === 0 && <NoDataBox />}
			<div className="flex flex-col gap-2 md:grid md:grid-cols-2 lg:grid-cols-3 w-full">
				{isLoading && <ThreadLoading />}
				<AnimatePresence>
					{mediaThreads?.map((thread) => (
						<MediaItem
							key={thread.id}
							thread={thread}
							onClick={async (item) => {
								const selectedMedia = mediaThreads.find(
									(i) => i.id === item.id,
								);
								console.log("🚀 ~ selectedMedia", selectedMedia);
								window.open(item.url, "_blank");
							}}
						/>
					))}
				</AnimatePresence>
			</div>
		</div>
	);
};

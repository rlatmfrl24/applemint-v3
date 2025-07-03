import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import type { MediaItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import NoDataBox from "../no-data";
import { ThreadLoading } from "../thread-loading";
import { MediaItem } from "./item-media";

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
		<div className="flex max-w-full flex-col-reverse gap-2 md:flex-row">
			{!isLoading && mediaThreads?.length === 0 ? (
				<NoDataBox />
			) : (
				<div className="flex w-full flex-col gap-2 md:grid md:grid-cols-2 lg:grid-cols-3">
					{isLoading && <ThreadLoading />}
					<AnimatePresence>
						{mediaThreads?.map((thread) => (
							<MediaItem
								key={thread.id}
								thread={thread}
								onClick={async (item) => {
									const selectedMedia = mediaThreads.find((i) => i.id === item.id);
									console.log("🚀 ~ selectedMedia", selectedMedia);
									window.open(item.url, "_blank");
								}}
							/>
						))}
					</AnimatePresence>
				</div>
			)}
		</div>
	);
};

import type { MediaItemType, ThreadItemType } from "@/lib/typeDefs";
import { MediaItem } from "./item-media";
import { useEffect, useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import Image from "next/image";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createClient } from "@/utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { ThreadLoading } from "../thread-loading";

async function getMediaData(item: ThreadItemType) {
	// case 1: direct image url
	if (item.url.match(/\.(jpeg|jpg|gif|png)$/) != null) {
		return [item.url];
	}

	// case 2: direct video url
	if (item.url.match(/\.(mp4|webm)$/) != null) {
		return [item.url];
	}

	// case 3: imgur album
	if (item.url.match(/imgur.com\/a\//) != null) {
		const albumId = item.url.split("/")[item.url.split("/").length - 1];
		const response = await fetch(`/api/imgur?type=album&id=${albumId}`);
		const data = await response.json();

		console.log("🚀 ~ getMediaData ~ data", data);
		return data.data.images.map((img: { link: string }) => img.link);
	}

	// case 4: imgur image
	if (item.url.match(/imgur.com\/[^/]+$/) != null) {
		const imageId = item.url.split("/")[item.url.split("/").length - 1];
		const response = await fetch(`/api/imgur?type=normal&id=${imageId}`);
		const data = await response.json();

		console.log("🚀 ~ getMediaData ~ data", data);
		return [data.data.link];
	}

	// case 5: etc
	return [];
}

export const MediaThreads = () => {
	const [selectedItem, setSelectedItem] = useState<MediaItemType | null>(null);
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
			<div className="flex flex-col gap-2 flex-1 w-full md:w-1/2">
				<Card>
					<CardHeader>
						<CardTitle>Items: {mediaThreads?.length}</CardTitle>
					</CardHeader>
				</Card>
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

								// const isMediumScreen = window.matchMedia("(min-width: 768px)");

								// if (!isMediumScreen.matches) {
								// 	window.open(item.url, "_blank");
								// 	return;
								// }

								// if (selectedMedia?.media && selectedMedia.media.length > 0) {
								// 	setSelectedItem(selectedMedia);
								// } else {
								// 	const media = await getMediaData(item);

								// 	if (!media) {
								// 		// open new tab
								// 		window.open(item.url, "_blank");
								// 	}

								// 	setSelectedItem({
								// 		...item,
								// 		media: media ? media : null,
								// 	});
								// }
							}}
						/>
					))}
				</AnimatePresence>
			</div>
			{/* <div className="flex-1 h-fit sticky top-2 hidden md:block">
				<PinnedMedia item={selectedItem} />
			</div> */}
		</div>
	);
};

const PinnedMedia = ({ item }: { item: MediaItemType | null }) => {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{item ? item.title : "No Item Selected"}</CardTitle>
				<CardDescription>
					{item?.url
						? item.url
						: "Please select an item to view media or open the link in a new tab."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<AspectRatio ratio={16 / 9}>
					{item?.media?.map((media) => {
						// media is image
						if (media.match(/\.(jpeg|jpg|gif|png)$/) != null) {
							return (
								<Image
									key={media}
									src={media}
									alt=""
									width={0}
									height={0}
									sizes="100vw"
									data-loaded="false"
									onLoad={(event) => {
										event.currentTarget.setAttribute("data-loaded", "true");
									}}
									className="object-contain rounded-md w-full h-full data-[loaded=false]:animate-pulse data-[loaded=false]:bg-gray-100/10"
								/>
							);
						}
						// media is video
						if (media.match(/\.(mp4|webm)$/) != null) {
							return (
								<video
									key={media}
									src={media}
									controls
									width={0}
									height={0}
									className="object-contain rounded-md w-full h-full"
								>
									<track
										kind="captions"
										srcLang="en"
										label="English captions"
										default
									/>
								</video>
							);
						}
					})}
					{(item?.media?.length === 0 || item === null) && (
						<Alert className="h-full" />
					)}
				</AspectRatio>
			</CardContent>
		</Card>
	);
};

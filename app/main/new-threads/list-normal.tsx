import type { ThreadItemType } from "@/lib/typeDefs";
import { AnimatePresence } from "framer-motion";
import { createClient } from "@/utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { DefaultThreadItem } from "../thread-item";
import { ThreadLoading } from "../thread-loading";
import { Card, CardHeader } from "@/components/ui/card";
import { QuickSaveButton } from "../quick-save-button";
import NoDataBox from "../no-data";

export const NormalThreads = () => {
	const supabase = createClient();

	const {
		data: normalThreads,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["new-threads"],
		queryFn: async () => {
			const { data, error } = await supabase
				.from("new-threads")
				.select()
				.neq("type", "media")
				.neq("type", "youtube")
				.order("created_at", { ascending: false })
				.order("id", { ascending: false });

			if (error) {
				console.error(error);
			}

			return data as ThreadItemType[];
		},
	});

	const typeList = [
		{
			type: "battlepage",
			name: "Battlepage",
		},
		{
			type: "fmkorea",
			name: "Fmkorea",
		},
		{
			type: "arcalive",
			name: "Arcalive",
		},
		{
			type: "issuelink",
			name: "Issuelink",
		},
		{
			type: "normal",
			name: "ETC",
		},
	];

	return (
		<div className="flex flex-col gap-2">
			<Card>
				<CardHeader>
					<div className="flex">
						{typeList.map((type) => (
							<div key={type.type} className="flex-1 text-center">
								<h5>{type.name}</h5>
								<span className="font-bold text-2xl md:text-5xl">
									{
										normalThreads?.filter((thread) => thread.type === type.type)
											.length
									}
								</span>
							</div>
						))}
					</div>
				</CardHeader>
			</Card>
			{isLoading && <ThreadLoading />}
			{(!normalThreads || normalThreads.length === 0) && <NoDataBox />}
			<AnimatePresence>
				{normalThreads?.map((thread) => (
					<DefaultThreadItem
						key={thread.id}
						thread={thread}
						threadName="new-threads"
						extraButtons={<QuickSaveButton thread={thread} />}
					/>
				))}
			</AnimatePresence>
		</div>
	);
};
